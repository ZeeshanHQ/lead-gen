import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createDb, type DbHandle } from "../../src/server/db/client";
import { bootstrap } from "../../src/server/db/bootstrap";
import { createCandidate } from "../../src/server/repo/companies";
import { approveCompany } from "../../src/server/repo/approvals";
import { companies } from "../../src/server/db/schema";
import { eq } from "drizzle-orm";
import {
  recordCallFeedback,
  updateLeadFollowUp,
  updateLeadCrmDetails,
  resetLeadCallStatus,
} from "../../src/server/repo/caller";
import { parseFollowUpMs } from "../../src/server/domain/call-time";

describe("Phase 1: Dual-Write & Follow-Up / Pain Columns", () => {
  let handle: DbHandle;
  let testCompanyId: string;

  beforeAll(async () => {
    handle = await createDb("memory://");
    await bootstrap(handle.db);

    const candidate = await createCandidate(
      handle.db,
      {
        name: "Acme Air Conditioning",
        website: "https://acmeairconditioningtest.com",
        phone: "(512) 555-1234",
        city: "Austin",
        state: "TX",
      },
      { actor: "setup" }
    );
    if (candidate.kind !== "created") throw new Error(`Candidate creation failed: ${candidate.kind}`);
    testCompanyId = candidate.id;

    await approveCompany(handle.db, testCompanyId, {
      actor: "admin",
      note: "Approved for call testing",
    });
  });

  afterAll(async () => {
    await handle.close();
  });

  it("persists both next_follow_up_at and pain_identified on call logging", async () => {
    const followUpStr = "2026-11-25T15:00";
    const painText = "High technician turnover and dispatch delays";

    const res = await recordCallFeedback(handle.db, {
      companyId: testCompanyId,
      actor: "Hamda",
      callOutcome: "CONNECTED",
      callerNotes: "Spoke with owner, very interested in automation.",
      followUpDate: followUpStr,
      painIdentified: painText,
      clientLogId: "p1_test_log_1",
    });

    expect(res.ok).toBe(true);

    const row = (await handle.db
      .select({
        notes: companies.notes,
        nextFollowUpAt: companies.nextFollowUpAt,
        painIdentified: companies.painIdentified,
      })
      .from(companies)
      .where(eq(companies.id, testCompanyId)))[0]!;

    // 1. Text notes contain standard tag
    expect(row.notes).toContain(`[Next Follow-up Scheduled: ${followUpStr}]`);

    // 2. SQL columns are populated
    expect(row.nextFollowUpAt).toBeInstanceOf(Date);
    const expectedUtcMs = parseFollowUpMs(followUpStr)!;
    expect(row.nextFollowUpAt?.getTime()).toBe(expectedUtcMs);
    expect(row.painIdentified).toBe(painText);
  });

  it("preserves pain_identified when a subsequent call logs without pain", async () => {
    const res = await recordCallFeedback(handle.db, {
      companyId: testCompanyId,
      actor: "Hamda",
      callOutcome: "NO_ANSWER",
      callerNotes: "Quick redial attempt, voicemail left.",
      clientLogId: "p1_test_log_2",
    });

    expect(res.ok).toBe(true);

    const row = (await handle.db
      .select({ painIdentified: companies.painIdentified })
      .from(companies)
      .where(eq(companies.id, testCompanyId)))[0]!;

    // Pain point is preserved, never overwritten with empty
    expect(row.painIdentified).toBe("High technician turnover and dispatch delays");
  });

  it("updates next_follow_up_at when updateLeadFollowUp is called", async () => {
    const newFollowUpStr = "2026-11-28T10:00";
    await updateLeadFollowUp(handle.db, testCompanyId, newFollowUpStr, "Pushed callback", "Hamda");

    const row = (await handle.db
      .select({
        notes: companies.notes,
        nextFollowUpAt: companies.nextFollowUpAt,
      })
      .from(companies)
      .where(eq(companies.id, testCompanyId)))[0]!;

    expect(row.notes).toContain(`[Next Follow-up Scheduled: ${newFollowUpStr}]`);
    expect(row.nextFollowUpAt?.getTime()).toBe(parseFollowUpMs(newFollowUpStr));
  });

  it("clears next_follow_up_at when follow-up is cleared via updateLeadFollowUp", async () => {
    await updateLeadFollowUp(handle.db, testCompanyId, null, "Callback completed", "Hamda");

    const row = (await handle.db
      .select({
        notes: companies.notes,
        nextFollowUpAt: companies.nextFollowUpAt,
      })
      .from(companies)
      .where(eq(companies.id, testCompanyId)))[0]!;

    expect(row.notes).not.toContain("Follow-up Scheduled");
    expect(row.nextFollowUpAt).toBeNull();
  });

  it("syncs next_follow_up_at through updateLeadCrmDetails", async () => {
    const customFollowUp = "2026-12-01T14:00";
    await updateLeadCrmDetails(
      handle.db,
      {
        companyId: testCompanyId,
        nextFollowUp: customFollowUp,
      },
      "Admin"
    );

    const row = (await handle.db
      .select({
        notes: companies.notes,
        nextFollowUpAt: companies.nextFollowUpAt,
      })
      .from(companies)
      .where(eq(companies.id, testCompanyId)))[0]!;

    expect(row.notes).toContain(`[Next Follow-up Scheduled: ${customFollowUp}]`);
    expect(row.nextFollowUpAt?.getTime()).toBe(parseFollowUpMs(customFollowUp));
  });

  it("clears next_follow_up_at when outcome is reset via resetLeadCallStatus", async () => {
    await resetLeadCallStatus(handle.db, {
      companyId: testCompanyId,
      clearFollowUp: true,
      reason: "Reset for new campaign",
      actor: "Admin",
    });

    const row = (await handle.db
      .select({
        notes: companies.notes,
        nextFollowUpAt: companies.nextFollowUpAt,
      })
      .from(companies)
      .where(eq(companies.id, testCompanyId)))[0]!;

    expect(row.notes).not.toContain("Follow-up Scheduled");
    expect(row.nextFollowUpAt).toBeNull();
  });
});
