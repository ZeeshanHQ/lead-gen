import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createDb, type DbHandle } from "@/server/db/client";
import { bootstrap } from "@/server/db/bootstrap";
import { createCandidate } from "@/server/repo/companies";
import { addExclusion } from "@/server/repo/exclusions";
import { setFact } from "@/server/repo/facts";
import { addContact, getContactsForCompanies, toContactInput } from "@/server/repo/contacts";
import { pickBestContact } from "@/server/domain/contact";
import { calculateLeadScore } from "@/server/domain/rules";
import { getDefaultRule } from "@/server/repo/rules";
import { approveCompany, listSyncEligibleIds, getApprovalSummary } from "@/server/repo/approvals";
import { syncApprovedLeads } from "@/server/sheets/sync";
import { getCallerQueue, recordCallFeedback } from "@/server/repo/caller";
import { companies, leadScores, auditLogs, evidence } from "@/server/db/schema";
import { eq } from "drizzle-orm";

describe("Complete End-to-End Outbound Pipeline Integration", () => {
  let handle: DbHandle;

  beforeAll(async () => {
    handle = await createDb("memory://");
    await bootstrap(handle.db);
  });

  afterAll(async () => {
    await handle.close();
  });

  it("executes the entire lead journey from discovery through research, approval, sheets sync, to caller pain discovery", async () => {
    const db = handle.db;

    // ==========================================
    // STEP 1: EXCLUSION AND INTAKE
    // ==========================================
    await addExclusion(
      db,
      { kind: "domain", value: "nationalfranchisehvac.com", reason: "National franchise PE conglomerate" },
      "sales_lead"
    );

    // Excluded candidate intake is blocked
    const excludedCandidate = await createCandidate(
      db,
      {
        name: "National Franchise Dallas",
        website: "https://nationalfranchisehvac.com/locations/dallas",
        phone: "(214) 765-1111",
      },
      { actor: "intake_job" }
    );
    expect(excludedCandidate.kind).toBe("excluded");

    // Valid candidate intake
    const intakeRes = await createCandidate(
      db,
      {
        name: "Precision Air & Heating Solutions LLC",
        website: "https://precisionairheating.com",
        phone: "(817) 765-4321",
        address: "1240 Industrial Way",
        city: "Fort Worth",
        state: "TX",
        zip: "76102",
        provider: "directory",
      },
      { actor: "acca_directory" }
    );
    expect(intakeRes.kind).toBe("created");
    const companyId = (intakeRes as any).id;

    // Deduplication check: duplicate intake returns existing company
    const dupRes = await createCandidate(
      db,
      {
        name: "Precision Air and Heating",
        website: "https://www.precisionairheating.com/contact-us",
      },
      { actor: "web_search" }
    );
    expect(dupRes.kind).toBe("duplicate");
    expect((dupRes as any).existingId).toBe(companyId);

    // ==========================================
    // STEP 2: RESEARCH & EVIDENCE GATHERING
    // ==========================================
    // Record verified public facts with source quotes and URLs
    await setFact(db, {
      companyId,
      field: "replacement",
      value: "YES",
      confidence: 0.95,
      provenance: "PUBLICLY_VERIFIED",
      sourceType: "website",
      sourceUrl: "https://precisionairheating.com/ac-replacement",
      evidenceText: "Complete residential system replacements and high-efficiency heat pump upgrades.",
      actor: "crawler",
    });

    await setFact(db, {
      companyId,
      field: "financing",
      value: "YES",
      confidence: 0.9,
      provenance: "PUBLICLY_VERIFIED",
      sourceType: "website",
      sourceUrl: "https://precisionairheating.com/financing",
      evidenceText: "Low monthly payment financing available through GreenSky and Wells Fargo.",
      actor: "crawler",
    });

    await setFact(db, {
      companyId,
      field: "maintenance",
      value: "YES",
      confidence: 0.88,
      provenance: "PUBLICLY_VERIFIED",
      sourceType: "website",
      sourceUrl: "https://precisionairheating.com/comfort-club",
      evidenceText: "Join our Precision Comfort Club maintenance agreement for bi-annual tune-ups.",
      actor: "crawler",
    });

    await setFact(db, {
      companyId,
      field: "residential",
      value: "YES",
      confidence: 0.95,
      provenance: "PUBLICLY_VERIFIED",
      sourceType: "website",
      sourceUrl: "https://precisionairheating.com",
      evidenceText: "North Texas premier residential heating and air conditioning specialists.",
      actor: "crawler",
    });

    await setFact(db, {
      companyId,
      field: "multiple_technicians",
      value: "YES",
      confidence: 0.9,
      provenance: "PUBLICLY_VERIFIED",
      sourceType: "website",
      sourceUrl: "https://precisionairheating.com/team",
      evidenceText: "Our fleet of 15+ certified technicians serves Fort Worth daily.",
      actor: "crawler",
    });

    await setFact(db, {
      companyId,
      field: "website_alive",
      value: "YES",
      confidence: 1.0,
      provenance: "PUBLICLY_VERIFIED",
      sourceType: "website",
      sourceUrl: "https://precisionairheating.com",
      evidenceText: "Verified active website and reachable business phone line.",
      actor: "crawler",
    });

    await setFact(db, {
      companyId,
      field: "software",
      value: "servicetitan",
      confidence: 0.92,
      provenance: "PUBLICLY_VERIFIED",
      sourceType: "website",
      sourceUrl: "https://precisionairheating.com/schedule",
      evidenceText: "Online booking widget powered by ServiceTitan integration.",
      actor: "crawler",
    });

    // Add decision maker contact
    await addContact(
      db,
      {
        companyId,
        name: "Mark Henderson",
        title: "Founder & General Manager",
        phone: "(817) 765-9988",
        phoneType: "PUBLISHED_DIRECT",
        email: "mark@precisionairheating.com",
        sourceUrl: "https://precisionairheating.com/about-our-team",
        verified: true,
      },
      "crawler"
    );

    // Evaluate rules and store lead score
    const rule = await getDefaultRule(db);
    const [companyRow] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
    const factsMap = (companyRow!.facts as any) || {};
    const contactsMap = await getContactsForCompanies(db, [companyId]);
    const contactInputs = (contactsMap.get(companyId) ?? []).map(toContactInput);
    const bestContact = pickBestContact(contactInputs, "(817) 765-4321");

    const scoreResult = calculateLeadScore(
      {
        name: companyRow!.name,
        website: companyRow!.website,
        state: companyRow!.state,
        city: companyRow!.city,
        zip: companyRow!.zip,
        facts: factsMap,
        contacts: contactInputs,
        contactResearchDone: true,
      },
      rule.config
    );

    expect(scoreResult.icpScore).toBeGreaterThanOrEqual(60);
    expect(scoreResult.researchConfidence).toBeGreaterThan(0.7);

    // Save score and move to NEEDS_REVIEW
    await db.insert(leadScores).values({
      companyId,
      ruleId: rule.id,
      icpScore: scoreResult.icpScore,
      researchConfidence: Math.round(scoreResult.researchConfidence * 100),
      grade: scoreResult.grade,
      breakdown: { reasons: scoreResult.signalsPresent },
    });

    await db.update(companies).set({ status: "NEEDS_REVIEW", updatedAt: new Date() }).where(eq(companies.id, companyId));

    // ==========================================
    // STEP 3: REVIEW QUEUE & APPROVAL SUMMARY
    // ==========================================
    const summary = await getApprovalSummary(db, companyId);
    expect(summary.company.name).toBe("Precision Air & Heating Solutions LLC");
    expect(summary.bestContact.name).toBe("Mark Henderson");
    expect(summary.bestContact.phone).toBe("(817) 765-9988");
    expect(summary.bestContact.grade).toBe("A");
    expect(summary.evidenceCount).toBeGreaterThanOrEqual(4);
    expect(summary.unresearched).toBe(false);
    expect(summary.excluded).toBe(false);

    // Prior to approval, lead MUST NOT be eligible for sheet sync
    const preSyncEligible = await listSyncEligibleIds(db);
    expect(preSyncEligible.includes(companyId)).toBe(false);

    // Human Auditor approves lead
    await approveCompany(db, companyId, {
      actor: "senior_reviewer",
      note: "Strong fit: replacement focus, ServiceTitan detected, owner direct mobile verified.",
    });

    // After approval, lead IS eligible for sync
    const postSyncEligible = await listSyncEligibleIds(db);
    expect(postSyncEligible.includes(companyId)).toBe(true);

    // ==========================================
    // STEP 4: GOOGLE SHEETS LIVE SYNC
    // ==========================================
    const syncRes = await syncApprovedLeads(db, {
      actor: "sales_ops",
      dryRun: false,
    });

    expect(syncRes.syncedCount).toBe(1);
    expect(syncRes.rows.length).toBe(1);
    const syncedRow = syncRes.rows[0]!;
    expect(syncedRow.companyId).toBe(companyId);
    expect(syncedRow.contactName).toBe("Mark Henderson");
    expect(syncedRow.contactPhone).toBe("(817) 765-9988");
    expect(syncedRow.replacement).toBe("YES");
    expect(syncedRow.financing).toBe("YES");
    expect(syncedRow.software).toBe("servicetitan");

    // Company status is now SYNCED
    const [syncedCompany] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
    expect(syncedCompany!.status).toBe("SYNCED");

    // ==========================================
    // STEP 5: CALLER QUEUE & HUMAN PAIN DISCOVERY
    // ==========================================
    const callerQueue = await getCallerQueue(db);
    expect(callerQueue.some((q) => q.companyId === companyId)).toBe(true);
    const callerItem = callerQueue.find((q) => q.companyId === companyId)!;
    expect(callerItem.name).toBe("Precision Air & Heating Solutions LLC");
    expect(callerItem.bestContact.name).toBe("Mark Henderson");

    // Human Rep dials Mark Henderson and conducts discovery call
    const callRes = await recordCallFeedback(db, {
      companyId,
      actor: "cold_caller_jason",
      callOutcome: "CONNECTED",
      painIdentified: "Owner reported that CSRs take 48+ hours to send replacement quotes on weekends, losing 4-6 high-ticket bids per month to faster competitors.",
      softwareConfirmed: "servicetitan",
      fleetSizeConfirmed: 18,
      callerNotes: "Spoke with Mark Henderson for 12 minutes. Confirmed they run 18 trucks on ServiceTitan. Primary headache is quote latency and dropped follow-up.",
    });

    expect(callRes.ok).toBe(true);
    expect(callRes.nextStatus).toBe("PAIN_FOUND");

    // Verify company lifecycle status transitioned to PAIN_FOUND
    const [finalCompany] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
    expect(finalCompany!.status).toBe("PAIN_FOUND");
    expect(finalCompany!.notes).toContain("Spoke with Mark Henderson for 12 minutes");

    // Verify that human-confirmed facts have HUMAN_CONFIRMED provenance
    const finalFacts = finalCompany!.facts as any;
    expect(finalFacts.software.value).toBe("servicetitan");
    expect(finalFacts.software.provenance).toBe("HUMAN_CONFIRMED");
    
    // Check evidence row generated for software fact
    const [evRow] = await db.select().from(evidence).where(eq(evidence.id, finalFacts.software.evidenceId)).limit(1);
    expect(evRow?.evidenceText).toContain("Confirmed by cold_caller_jason");

    expect(finalFacts.employees.value).toBe("18");
    expect(finalFacts.employees.provenance).toBe("HUMAN_CONFIRMED");

    // Verify audit logs exist for each critical phase
    const audits = await db.select().from(auditLogs).where(eq(auditLogs.companyId, companyId));
    const actionTypes = audits.map((a) => a.action);
    expect(actionTypes).toContain("company.discovered");
    expect(actionTypes).toContain("lead.approved");
    expect(actionTypes).toContain("sheets.lead_synced");
    expect(actionTypes).toContain("caller.call_logged");
  });
});
