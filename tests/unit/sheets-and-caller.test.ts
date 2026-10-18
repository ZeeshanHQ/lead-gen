import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createDb, type DbHandle } from "@/server/db/client";
import { bootstrap } from "@/server/db/bootstrap";
import { createCandidate } from "@/server/repo/companies";
import { setFact } from "@/server/repo/facts";
import { addContact } from "@/server/repo/contacts";
import { approveCompany } from "@/server/repo/approvals";
import { syncApprovedLeads } from "@/server/sheets/sync";
import { getCallerQueue, recordCallFeedback } from "@/server/repo/caller";
import { companies, auditLogs } from "@/server/db/schema";
import { eq } from "drizzle-orm";

describe("Phase 6 & 7: Google Sheets Sync & Caller Queue / Pain Discovery", () => {
  let handle: DbHandle;
  let companyAId: string;
  let companyBId: string;

  beforeAll(async () => {
    handle = await createDb("memory://");
    await bootstrap(handle.db);

    // Create Company A (to be approved)
    const resA = await createCandidate(
      handle.db,
      {
        name: "Metro Air & Heat Pros",
        website: "https://metroairpros.com",
        phone: "(214) 765-4321",
        city: "Dallas",
        state: "TX",
        zip: "75201",
      },
      { actor: "test" }
    );
    expect(resA.kind).toBe("created");
    companyAId = (resA as any).id;

    // Add facts and contact to Company A
    await setFact(handle.db, {
      companyId: companyAId,
      field: "replacement",
      value: "YES",
      confidence: 0.95,
      provenance: "PUBLICLY_VERIFIED",
      sourceType: "website",
      sourceUrl: "https://metroairpros.com/services",
      evidenceText: "Specializing in full AC replacement and heat pump installation.",
      actor: "crawler",
    });

    await setFact(handle.db, {
      companyId: companyAId,
      field: "financing",
      value: "YES",
      confidence: 0.9,
      provenance: "PUBLICLY_VERIFIED",
      sourceType: "website",
      sourceUrl: "https://metroairpros.com/financing",
      evidenceText: "0% APR financing options through Wells Fargo.",
      actor: "crawler",
    });

    await addContact(
      handle.db,
      {
        companyId: companyAId,
        name: "Robert Davis",
        title: "Owner & President",
        phone: "(214) 765-8899",
        phoneType: "PUBLISHED_DIRECT",
        email: "robert@metroairpros.com",
        sourceUrl: "https://metroairpros.com/about",
        verified: true,
      },
      "crawler"
    );

    // Create Company B (unapproved / stays in NEEDS_REVIEW)
    const resB = await createCandidate(
      handle.db,
      {
        name: "Lone Star Mechanical",
        website: "https://lonestarhvac.com",
        phone: "(512) 887-3322",
        city: "Austin",
        state: "TX",
        zip: "78701",
      },
      { actor: "test" }
    );
    expect(resB.kind).toBe("created");
    companyBId = (resB as any).id;
  });

  afterAll(async () => {
    await handle.close();
  });

  describe("Google Sheets Sync Safety Gate", () => {
    it("strictly blocks unapproved leads from syncing", async () => {
      // Both leads are currently unapproved
      const preview = await syncApprovedLeads(handle.db, {
        actor: "sales_ops",
        dryRun: true,
      });

      expect(preview.syncedCount).toBe(0);
      expect(preview.rows.length).toBe(0);
    });

    it("syncs approved lead in dryRun mode without changing database status", async () => {
      // Human explicitly reviews and approves Company A
      await approveCompany(handle.db, companyAId, {
        actor: "auditor_alice",
        note: "Verified residential replacement focus and direct owner line.",
      });

      // Dry run sync
      const dryResult = await syncApprovedLeads(handle.db, {
        actor: "sales_ops",
        dryRun: true,
      });

      expect(dryResult.syncedCount).toBe(1);
      expect(dryResult.dryRun).toBe(true);
      expect(dryResult.rows.length).toBe(1);
      const row = dryResult.rows[0]!;
      expect(row.name).toBe("Metro Air & Heat Pros");
      expect(row.contactName).toBe("Robert Davis");
      expect(row.contactTitle).toBe("Owner & President");
      expect(row.contactPhone).toBe("(214) 765-8899");
      expect(row.replacement).toBe("YES");
      expect(row.financing).toBe("YES");

      // Verify DB status is still APPROVED (dryRun does not mutate)
      const [c] = await handle.db
        .select()
        .from(companies)
        .where(eq(companies.id, companyAId))
        .limit(1);
      expect(c).toBeDefined();
      expect(c!.status).toBe("APPROVED");
    });

    it("executes live sync, transitions status to SYNCED, and creates audit trail", async () => {
      const liveResult = await syncApprovedLeads(handle.db, {
        actor: "sales_ops",
        dryRun: false,
      });

      expect(liveResult.syncedCount).toBe(1);
      expect(liveResult.dryRun).toBe(false);
      expect(liveResult.rows.length).toBe(1);

      // Verify DB status transitioned to SYNCED
      const [c] = await handle.db
        .select()
        .from(companies)
        .where(eq(companies.id, companyAId))
        .limit(1);
      expect(c).toBeDefined();
      expect(c!.status).toBe("SYNCED");

      // Verify audit log
      const audits = await handle.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, "sheets.lead_synced"));
      expect(audits.length).toBeGreaterThan(0);
    });
  });

  describe("Caller Queue & Pain Discovery Workbench", () => {
    it("retrieves the active caller queue sorted by ICP score with best contact", async () => {
      const queue = await getCallerQueue(handle.db);
      expect(queue.length).toBe(1);
      const lead = queue[0]!;

      expect(lead.companyId).toBe(companyAId);
      expect(lead.name).toBe("Metro Air & Heat Pros");
      expect(lead.status).toBe("SYNCED");
      expect(lead.bestContact.name).toBe("Robert Davis");
      expect(lead.bestContact.phone).toBe("(214) 765-8899");
      expect(lead.bestContact.grade).toBe("A");
      expect(lead.replacement).toBe("YES");
      expect(lead.financing).toBe("YES");
    });

    it("records phone discovery feedback, saves HUMAN_CONFIRMED facts, and marks PAIN_FOUND", async () => {
      const res = await recordCallFeedback(handle.db, {
        companyId: companyAId,
        actor: "rep_dan",
        callOutcome: "CONNECTED",
        painIdentified: "Missing weekend emergency replacement estimates. Office takes 48 hours to quote.",
        softwareConfirmed: "servicetitan",
        fleetSizeConfirmed: 14,
        callerNotes: "Spoke directly with Robert Davis. Very interested in automated weekend quote follow-up.",
      });

      expect(res.ok).toBe(true);
      expect(res.nextStatus).toBe("PAIN_FOUND");

      // Verify company status updated to PAIN_FOUND and notes appended
      const [c] = await handle.db
        .select()
        .from(companies)
        .where(eq(companies.id, companyAId))
        .limit(1);
      expect(c).toBeDefined();
      expect(c!.status).toBe("PAIN_FOUND");
      expect(c!.notes).toContain("Spoke directly with Robert Davis");

      // Verify HUMAN_CONFIRMED facts
      const facts = c!.facts as any;
      expect(facts.software.value).toBe("servicetitan");
      expect(facts.software.provenance).toBe("HUMAN_CONFIRMED");
      expect(facts.software.confidence).toBe(1.0);

      expect(facts.employees.value).toBe("14");
      expect(facts.employees.provenance).toBe("HUMAN_CONFIRMED");
      expect(facts.employees.confidence).toBe(1.0);

      // Verify audit log
      const audits = await handle.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, "caller.call_logged"));
      expect(audits.length).toBeGreaterThan(0);
    });

    it("records meeting booked outcome", async () => {
      const res = await recordCallFeedback(handle.db, {
        companyId: companyAId,
        actor: "rep_dan",
        callOutcome: "MEETING_BOOKED",
        callerNotes: "Demo scheduled for Thursday at 2 PM with Robert and General Manager.",
      });

      expect(res.ok).toBe(true);
      expect(res.nextStatus).toBe("MEETING_BOOKED");

      const [c] = await handle.db
        .select()
        .from(companies)
        .where(eq(companies.id, companyAId))
        .limit(1);
      expect(c).toBeDefined();
      expect(c!.status).toBe("MEETING_BOOKED");
      expect(c!.notes).toContain("Demo scheduled for Thursday");
    });
  });
});
