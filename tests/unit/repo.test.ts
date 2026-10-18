import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createDb, type DbHandle } from "@/server/db/client";
import { bootstrap } from "@/server/db/bootstrap";
import { createCandidate, editCompany } from "@/server/repo/companies";
import { addExclusion } from "@/server/repo/exclusions";
import { setFact, clearFact, acceptSuggestion } from "@/server/repo/facts";
import { addContact } from "@/server/repo/contacts";
import { approveCompany, rejectCompany, restoreCompany, listSyncEligibleIds, getApprovalSummary } from "@/server/repo/approvals";
import { getCompanyDetail, getEvidenceDrawer, getOverview } from "@/server/repo/detail";
import { getDefaultRule, saveRule, reEvaluateLeadsWithRule } from "@/server/repo/rules";
import { setSetting, getSetting } from "@/server/repo/settings";

describe("Repository integration with memory PGlite", () => {
  let handle: DbHandle;

  beforeAll(async () => {
    handle = await createDb("memory://");
    await bootstrap(handle.db);
  });

  afterAll(async () => {
    await handle.close();
  });

  it("bootstraps with default HVAC rule and system settings", async () => {
    const rule = await getDefaultRule(handle.db);
    expect(rule.name).toBe("US Residential HVAC — Call Ready Prospect");
    expect(rule.config.businessType).toBe("residential");

    const staleDays = await getSetting(handle.db, "stale_days");
    expect(staleDays).toBe(30);
  });

  it("candidate intake: handles validation, exclusions, and dedupe", async () => {
    // 1. Validation error
    const invalid = await createCandidate(handle.db, { name: "" }, { actor: "test" });
    expect(invalid.kind).toBe("invalid");

    // 2. Add an exclusion
    await addExclusion(handle.db, { kind: "domain", value: "spammer.com", reason: "Known bad domain" }, "test");
    const excluded = await createCandidate(handle.db, { name: "Spam Co", website: "https://spammer.com" }, { actor: "test" });
    expect(excluded.kind).toBe("excluded");

    // 3. Create a valid candidate
    const created = await createCandidate(handle.db, {
      name: "Apex Comfort Systems, LLC",
      website: "https://apexcomfort.com",
      phone: "(214) 555-4321",
      city: "Dallas",
      state: "TX",
      zip: "75201",
    }, { actor: "test" });
    expect(created.kind).toBe("created");
    const companyId = (created as { kind: "created"; id: string }).id;

    // 4. Duplicate intake with different capitalization/casing and legal suffix
    const dup = await createCandidate(handle.db, {
      name: "APEX COMFORT SYSTEMS INC",
      website: "https://www.apexcomfort.com/contact",
    }, { actor: "test" });
    expect(dup.kind).toBe("duplicate");
    expect((dup as any).existingId).toBe(companyId);

    // Detail check
    const detail = await getCompanyDetail(handle.db, companyId);
    expect(detail).not.toBeNull();
    expect(detail?.company.name).toBe("Apex Comfort Systems, LLC");
    expect(detail?.refs.length).toBeGreaterThanOrEqual(2); // canonical record holds source refs underneath
  });

  it("facts and evidence: single write path, locking, and conflict handling", async () => {
    const created = await createCandidate(handle.db, {
      name: "Dallas Air Pros",
      website: "https://dallasairpros.com",
      city: "Dallas",
      state: "TX",
    }, { actor: "test" });
    const companyId = (created as any).id;

    // Set a publicly verified fact with evidence
    const r1 = await setFact(handle.db, {
      companyId,
      field: "replacement",
      value: "YES",
      confidence: 0.95,
      provenance: "PUBLICLY_VERIFIED",
      sourceType: "website",
      sourceUrl: "https://dallasairpros.com/services",
      evidenceText: "Specializing in full AC system replacements and heating unit installations.",
      actor: "crawler",
    });
    expect(r1.outcome).toBe("applied");

    let detail = await getCompanyDetail(handle.db, companyId);
    expect(detail?.company.facts.replacement?.value).toBe("YES");
    expect(detail?.company.facts.replacement?.confidence).toBe(0.95);

    // Human edits the fact (locking it)
    const r2 = await setFact(handle.db, {
      companyId,
      field: "replacement",
      value: "YES",
      confidence: 1.0,
      provenance: "HUMAN_CONFIRMED",
      sourceType: "manual_entry",
      evidenceText: "Confirmed via phone call with manager.",
      actor: "sales_rep",
    });
    expect(r2.outcome).toBe("applied");

    detail = await getCompanyDetail(handle.db, companyId);
    expect(detail?.company.lockedFields).toContain("replacement");

    // Later automation attempts to change a human-confirmed field -> files a suggestion
    const r3 = await setFact(handle.db, {
      companyId,
      field: "replacement",
      value: "NO",
      confidence: 0.85,
      provenance: "PUBLICLY_VERIFIED",
      sourceType: "website",
      sourceUrl: "https://dallasairpros.com/faq",
      evidenceText: "We only do light tuneups and filters.",
      actor: "crawler",
    });
    expect(r3.outcome).toBe("suggested");

    // Check suggestions
    detail = await getCompanyDetail(handle.db, companyId);
    expect(detail?.suggestions.length).toBe(1);
    expect(detail?.suggestions[0]?.suggestedValue).toBe("NO");

    // Accept suggestion
    await acceptSuggestion(handle.db, detail!.suggestions[0]!.id, "reviewer");
    detail = await getCompanyDetail(handle.db, companyId);
    expect(detail?.company.facts.replacement?.value).toBe("NO");
    expect(detail?.suggestions.length).toBe(0);

    // Evidence drawer
    const drawer = await getEvidenceDrawer(handle.db, companyId);
    expect(drawer?.facts.length).toBeGreaterThan(0);
  });

  it("contacts: adding verified contact and best contact picking", async () => {
    const created = await createCandidate(handle.db, {
      name: "Summit HVAC",
      website: "https://summithvac.com",
      phone: "(214) 555-8888",
    }, { actor: "test" });
    const companyId = (created as any).id;

    // Add owner contact
    const cRes = await addContact(handle.db, {
      companyId,
      name: "Marcus Vance",
      title: "President & Founder",
      phone: "(214) 555-9999",
      phoneType: "PUBLISHED_DIRECT",
      email: "marcus@summithvac.com",
      verified: true,
      sourceUrl: "https://summithvac.com/about-us",
    }, "reviewer");
    expect(cRes.ok).toBe(true);

    const detail = await getCompanyDetail(handle.db, companyId);
    expect(detail?.best.priority).toBe(1);
    expect(detail?.best.grade).toBe("A");
    expect(detail?.best.name).toBe("Marcus Vance");
    expect(detail?.best.phone).toBe("(214) 555-9999");
  });

  it("approval flow: approve, reject, restore, and sync eligibility gate", async () => {
    const created = await createCandidate(handle.db, {
      name: "Lone Star Heating & Air",
      website: "https://lonestarhvac.com",
      phone: "(512) 555-1122",
      city: "Austin",
      state: "TX",
    }, { actor: "test" });
    const companyId = (created as any).id;

    // Initially discovered -> NOT sync eligible
    let eligible = await listSyncEligibleIds(handle.db);
    expect(eligible).not.toContain(companyId);

    // Add some research evidence
    await setFact(handle.db, {
      companyId,
      field: "residential",
      value: "YES",
      confidence: 0.9,
      provenance: "PUBLICLY_VERIFIED",
      sourceType: "website",
      sourceUrl: "https://lonestarhvac.com",
      evidenceText: "Central Texas Residential Heating and Air Conditioning Specialists.",
      actor: "crawler",
    });

    // Approve the company
    await approveCompany(handle.db, companyId, { actor: "lead_reviewer", note: "Verified residential focus" });

    eligible = await listSyncEligibleIds(handle.db);
    expect(eligible).toContain(companyId);

    // Rejecting moves out of sync eligibility
    // Note: APPROVED can transition to REJECTED
    await rejectCompany(handle.db, companyId, { actor: "lead_reviewer", reason: "Out of area" });
    eligible = await listSyncEligibleIds(handle.db);
    expect(eligible).not.toContain(companyId);

    // Restore moves back to NEEDS_REVIEW
    await restoreCompany(handle.db, companyId, "lead_reviewer");
    const detail = await getCompanyDetail(handle.db, companyId);
    expect(detail?.company.status).toBe("NEEDS_REVIEW");
  });

  it("overview stats accurately aggregates data", async () => {
    const overview = await getOverview(handle.db);
    expect(overview.total).toBeGreaterThanOrEqual(4);
    expect(overview.evidenceTotal).toBeGreaterThan(0);
    expect(overview.recent.length).toBeGreaterThan(0);
  });

  it("updates active rules in backend and re-evaluates candidate leads in real-time", async () => {
    const rule = await getDefaultRule(handle.db);
    const updatedConfig = {
      ...rule.config,
      scoring: {
        ...rule.config.scoring,
        minScore: 65, // Lower threshold
      },
      businessType: "residential" as const,
    };

    // Save rule
    const saved = await saveRule(
      handle.db,
      rule.id,
      { name: "Updated Active Rule Profile", config: updatedConfig },
      "sales_director"
    );

    expect(saved.version).toBe(rule.version + 1);
    expect(saved.name).toBe("Updated Active Rule Profile");

    // Real-time re-evaluation of leads
    const reEvalResult = await reEvaluateLeadsWithRule(handle.db, rule.id, "sales_director");
    expect(reEvalResult.reScoredCount).toBeGreaterThanOrEqual(1);

    // Verify default rule now reflects updated version and threshold
    const activeRule = await getDefaultRule(handle.db);
    expect(activeRule.version).toBe(saved.version);
    expect(activeRule.config.scoring.minScore).toBe(65);
  });
});
