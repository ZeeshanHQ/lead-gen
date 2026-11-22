import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createDb, type DbHandle } from "../../src/server/db/client";
import { bootstrap } from "../../src/server/db/bootstrap";
import { createCandidate } from "../../src/server/repo/companies";
import { approveCompany } from "../../src/server/repo/approvals";
import { companies, dncSuggestions, exclusions, auditLogs } from "../../src/server/db/schema";
import { eq } from "drizzle-orm";
import { detectDncLanguage } from "../../src/server/domain/call-outcomes";
import { recordCallFeedback } from "../../src/server/repo/caller";
import {
  acceptDncSuggestion,
  dismissDncSuggestion,
  listPendingDncSuggestions,
  getPendingDncSuggestionsCount,
} from "../../src/server/repo/dnc-suggestions";
import { listNotificationsForMember } from "../../src/server/repo/notifications";
import { getAdminMonitorMetrics } from "../../src/server/repo/activities";

describe("Phase 5: DNC Automation & Blocklist Suggestions", () => {
  let handle: DbHandle;
  let companyId1: string;
  let companyId2: string;
  let companyId3: string;

  beforeAll(async () => {
    handle = await createDb("memory://");
    await bootstrap(handle.db);

    // Company 1: Phone + Domain
    const cand1 = await createCandidate(
      handle.db,
      {
        name: "Grand View Realty",
        website: "https://grandviewrealty.test",
        phone: "(415) 555-9876",
        city: "San Francisco",
        state: "CA",
      },
      { actor: "setup" }
    );
    if (cand1.kind !== "created") throw new Error("Failed to create candidate 1");
    companyId1 = cand1.id;
    await approveCompany(handle.db, companyId1, { actor: "admin@astraventa.com", note: "Approved" });

    // Company 2: Domain only, no phone
    const cand2 = await createCandidate(
      handle.db,
      {
        name: "Bay Area Homes LLC",
        website: "https://bayareahomes.test",
        city: "Oakland",
        state: "CA",
      },
      { actor: "setup" }
    );
    if (cand2.kind !== "created") throw new Error("Failed to create candidate 2");
    companyId2 = cand2.id;
    await approveCompany(handle.db, companyId2, { actor: "admin@astraventa.com", note: "Approved" });

    // Company 3: Standard lead
    const cand3 = await createCandidate(
      handle.db,
      {
        name: "Sunset Valley Properties",
        phone: "(512) 555-1122",
        city: "Austin",
        state: "TX",
      },
      { actor: "setup" }
    );
    if (cand3.kind !== "created") throw new Error("Failed to create candidate 3");
    companyId3 = cand3.id;
    await approveCompany(handle.db, companyId3, { actor: "admin@astraventa.com", note: "Approved" });
  });

  afterAll(async () => {
    await handle.close();
  });

  describe("1. DNC Language Detection (NLP/Regex)", () => {
    it("detects explicit 'do not call' phrases", () => {
      const res = detectDncLanguage("Spoke with owner, they said do not call again");
      expect(res.isDnc).toBe(true);
      expect(res.matchedKeyword?.toLowerCase()).toContain("do not call");
    });

    it("detects DNC acronym and list removal phrases", () => {
      expect(detectDncLanguage("Owner requested DNC").isDnc).toBe(true);
      expect(detectDncLanguage("Remove me from your list please").isDnc).toBe(true);
      expect(detectDncLanguage("Take us off your call list immediately").isDnc).toBe(true);
      expect(detectDncLanguage("Stop calling this office").isDnc).toBe(true);
      expect(detectDncLanguage("Never call here again").isDnc).toBe(true);
      expect(detectDncLanguage("Threatened with lawyer, harassment").isDnc).toBe(true);
    });

    it("ignores generic refusal without DNC demand", () => {
      const res = detectDncLanguage("Not interested in software, already satisfied with current tool");
      expect(res.isDnc).toBe(false);
    });

    it("ignores deferrals even if they mention calling later", () => {
      const res = detectDncLanguage("Cannot talk right now, call back tomorrow afternoon");
      expect(res.isDnc).toBe(false);
    });

    it("ignores time constraints like 'do not call before 2pm'", () => {
      const res = detectDncLanguage("Busy in the morning, do not call before 2pm");
      expect(res.isDnc).toBe(false);
    });
  });

  describe("2. Automatic DNC Suggestion in recordCallFeedback", () => {
    it("auto-creates a pending DNC suggestion when NOT_INTERESTED is logged with DNC words", async () => {
      const feedbackRes = await recordCallFeedback(handle.db, {
        companyId: companyId1,
        actor: "Hamda",
        callOutcome: "NOT_INTERESTED",
        callerNotes: "Spoke with owner. Screamed do not call ever again and hung up.",
      });

      expect(feedbackRes.ok).toBe(true);
      expect(feedbackRes.nextStatus).toBe("LOST");
      expect(feedbackRes.dncSuggested).toBe(true);

      // Verify row in dnc_suggestions table
      const pendingList = await listPendingDncSuggestions(handle.db);
      const sug = pendingList.find((s) => s.companyId === companyId1);
      expect(sug).toBeDefined();
      expect(sug?.companyName).toBe("Grand View Realty");
      expect(sug?.suggestedKind).toBe("phone");
      expect(sug?.status).toBe("PENDING");
      expect(sug?.callerNotes).toContain("do not call ever again");
      expect(sug?.suggestedBy).toBe("Hamda");

      // Verify notification sent to OWNER
      const notifs = await listNotificationsForMember(handle.db, "member_owner", "OWNER");
      const dncNotif = notifs.find((n) => n.category === "dnc_suggested");
      expect(dncNotif).toBeDefined();
      expect(dncNotif?.title).toBe("DNC Exclusion Suggested");
      expect(dncNotif?.message).toContain("Grand View Realty");
    });

    it("does NOT auto-suggest DNC when NOT_INTERESTED has no DNC language", async () => {
      const initialCount = await getPendingDncSuggestionsCount(handle.db);

      const feedbackRes = await recordCallFeedback(handle.db, {
        companyId: companyId3,
        actor: "Hamda",
        callOutcome: "NOT_INTERESTED",
        callerNotes: "Spoke with owner. Just not looking to switch right now.",
      });

      expect(feedbackRes.ok).toBe(true);
      expect(feedbackRes.dncSuggested).toBe(false);

      const afterCount = await getPendingDncSuggestionsCount(handle.db);
      expect(afterCount).toBe(initialCount);
    });

    it("creates DNC suggestion when caller explicitly checks requestDnc even without keywords", async () => {
      const feedbackRes = await recordCallFeedback(handle.db, {
        companyId: companyId3,
        actor: "Hamda",
        callOutcome: "NOT_INTERESTED",
        callerNotes: "Declined offer politely but requested exclusion verbally",
        requestDnc: true,
      });

      expect(feedbackRes.ok).toBe(true);
      expect(feedbackRes.dncSuggested).toBe(true);

      const pending = await listPendingDncSuggestions(handle.db);
      const sug = pending.find((s) => s.companyId === companyId3);
      expect(sug).toBeDefined();
      expect(sug?.suggestedKind).toBe("phone");
    });
  });

  describe("3. 1-Click Accept DNC Suggestion", () => {
    it("accepts DNC suggestion, inserts exclusion rule, updates company notes and status", async () => {
      const pending = await listPendingDncSuggestions(handle.db);
      const sug = pending.find((s) => s.companyId === companyId1);
      expect(sug).toBeDefined();

      const acceptRes = await acceptDncSuggestion(handle.db, sug!.id, "admin@astraventa.com");
      expect(acceptRes.ok).toBe(true);
      expect(acceptRes.exclusion).toBeDefined();
      expect(acceptRes.exclusion.kind).toBe("phone");
      expect(acceptRes.suggestion.status).toBe("ACCEPTED");

      // Verify active exclusion exists in exclusions table
      const [exRow] = await handle.db
        .select()
        .from(exclusions)
        .where(eq(exclusions.id, acceptRes.exclusion.id));
      expect(exRow).toBeDefined();
      expect(exRow?.status).toBe("ACTIVE");
      expect(exRow?.kind).toBe("phone");

      // Verify company has DNC tag in notes and status is LOST
      const [comp] = await handle.db
        .select()
        .from(companies)
        .where(eq(companies.id, companyId1));
      expect(comp?.status).toBe("LOST");
      expect(comp?.notes).toContain("[DNC Exclusion Confirmed:");

      // Verify audit log
      const audits = await handle.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, "dnc_suggestion.accepted"));
      expect(audits.length).toBeGreaterThan(0);
    });
  });

  describe("4. Dismiss DNC Suggestion", () => {
    it("dismisses DNC suggestion without adding to exclusions blocklist", async () => {
      const pending = await listPendingDncSuggestions(handle.db);
      const sug = pending.find((s) => s.companyId === companyId3);
      expect(sug).toBeDefined();

      const countBefore = (await handle.db.select().from(exclusions)).length;

      const dismissRes = await dismissDncSuggestion(handle.db, sug!.id, "admin@astraventa.com", "False alarm");
      expect(dismissRes.ok).toBe(true);
      expect(dismissRes.suggestion.status).toBe("DISMISSED");

      const countAfter = (await handle.db.select().from(exclusions)).length;
      expect(countAfter).toBe(countBefore); // No new exclusions added
    });
  });

  describe("5. Admin Monitor Integration", () => {
    it("reports pending DNC suggestions count in getAdminMonitorMetrics", async () => {
      // Create a fresh DNC suggestion for companyId2 (domain-only company)
      await recordCallFeedback(handle.db, {
        companyId: companyId2,
        actor: "Hamda",
        callOutcome: "NOT_INTERESTED",
        callerNotes: "Take us off your list, do not call",
      });

      const metrics = await getAdminMonitorMetrics(handle.db);
      expect(metrics.pendingDncCount).toBeDefined();
      expect(metrics.pendingDncCount).toBeGreaterThanOrEqual(1);
    });
  });
});
