import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createDb, type DbHandle } from "../../src/server/db/client";
import { bootstrap } from "../../src/server/db/bootstrap";
import { createCandidate } from "../../src/server/repo/companies";
import { approveCompany } from "../../src/server/repo/approvals";
import { companies, meetings } from "../../src/server/db/schema";
import { eq } from "drizzle-orm";
import { recordCallFeedback, updateCompanyDealStage } from "../../src/server/repo/caller";
import { bookDiscoveryMeeting, updateMeetingOutcome } from "../../src/server/repo/meetings";
import { getUnifiedCompanyTimeline } from "../../src/server/repo/timeline";
import { computeFunnel, type FunnelLead } from "../../src/server/domain/funnel-analytics";

describe("Phase 6: Deal Pipeline Separation, Unified Timeline & Deal Board", () => {
  let handle: DbHandle;
  let testCompanyId: string;

  beforeAll(async () => {
    handle = await createDb("memory://");
    await bootstrap(handle.db);

    const cand = await createCandidate(
      handle.db,
      {
        name: "Omni HVAC Solutions",
        website: "https://omnihvac.test",
        phone: "(469) 555-8899",
        city: "Plano",
        state: "TX",
      },
      { actor: "setup" }
    );
    if (cand.kind !== "created") throw new Error("Failed to create candidate");
    testCompanyId = cand.id;
    await approveCompany(handle.db, testCompanyId, {
      actor: "admin@astraventa.com",
      note: "Approved for calling",
    });
  });

  afterAll(async () => {
    await handle.close();
  });

  describe("1. Initial Schema & Default Column State", () => {
    it("initializes new company with UNQUALIFIED qualification and NONE deal stage", async () => {
      const [comp] = await handle.db
        .select()
        .from(companies)
        .where(eq(companies.id, testCompanyId));

      expect(comp).toBeDefined();
      expect(comp!.qualificationStatus).toBe("UNQUALIFIED");
      expect(comp!.dealStage).toBe("NONE");
      expect(comp!.dealValueUsd).toBeNull();
    });
  });

  describe("2. Auto-sync from Call Feedback", () => {
    it("sets qualification_status = PAIN_IDENTIFIED when pain is recorded on call", async () => {
      await recordCallFeedback(handle.db, {
        companyId: testCompanyId,
        callOutcome: "CONNECTED",
        callerNotes: "Spoke with owner Mark. High dispatcher turnover and losing weekend calls.",
        painIdentified: "Dispatcher turnover and lost weekend emergency calls",
        actor: "Hamda",
      });

      const [comp] = await handle.db
        .select()
        .from(companies)
        .where(eq(companies.id, testCompanyId));

      expect(comp!.qualificationStatus).toBe("PAIN_IDENTIFIED");
      expect(comp!.dealStage).toBe("NONE");
      expect(comp!.painIdentified).toBe("Dispatcher turnover and lost weekend emergency calls");
    });

    it("sets qualification_status = QUALIFIED and deal_stage = MEETING_BOOKED when meeting booked on call", async () => {
      await recordCallFeedback(handle.db, {
        companyId: testCompanyId,
        callOutcome: "MEETING_BOOKED",
        callerNotes: "Mark agreed to a 15-minute zoom discovery call tomorrow at 2 PM.",
        actor: "Hamda",
      });

      const [comp] = await handle.db
        .select()
        .from(companies)
        .where(eq(companies.id, testCompanyId));

      expect(comp!.qualificationStatus).toBe("QUALIFIED");
      expect(comp!.dealStage).toBe("MEETING_BOOKED");
      expect(comp!.status).toBe("MEETING_BOOKED");
    });

    it("disqualifies and sets deal_stage = CLOSED_LOST when NOT_INTERESTED is logged for an active deal", async () => {
      await recordCallFeedback(handle.db, {
        companyId: testCompanyId,
        callOutcome: "NOT_INTERESTED",
        callerNotes: "Mark called back saying his partner vetoed all software spend. Not interested.",
        actor: "Hamda",
      });

      const [comp] = await handle.db
        .select()
        .from(companies)
        .where(eq(companies.id, testCompanyId));

      expect(comp!.qualificationStatus).toBe("DISQUALIFIED");
      expect(comp!.dealStage).toBe("CLOSED_LOST");
      expect(comp!.status).toBe("LOST");
    });
  });

  describe("3. Structured Meetings Auto-sync", () => {
    let meetingCompanyId: string;
    let meetingId: string;

    beforeAll(async () => {
      const cand = await createCandidate(
        handle.db,
        {
          name: "BlueStar Mechanical",
          website: "https://bluestarmech.test",
          phone: "(214) 555-7766",
          city: "Fort Worth",
          state: "TX",
        },
        { actor: "setup" }
      );
      if (cand.kind !== "created") throw new Error("Failed to create candidate");
      meetingCompanyId = cand.id;
      await approveCompany(handle.db, meetingCompanyId, {
        actor: "admin@astraventa.com",
        note: "Approved",
      });
    });

    it("bookDiscoveryMeeting automatically sets QUALIFIED and MEETING_BOOKED", async () => {
      const res = await bookDiscoveryMeeting(handle.db, {
        companyId: meetingCompanyId,
        meetingAt: new Date(Date.now() + 48 * 3600 * 1000),
        platform: "ZOOM",
        attendeeName: "Sarah Connor",
        attendeeEmail: "sarah@bluestarmech.test",
        bookedBy: "Hamda",
        prepNotes: "Evaluating AI receptionists",
      });

      expect(res.ok).toBe(true);
      meetingId = res.meetingId;

      const [comp] = await handle.db
        .select()
        .from(companies)
        .where(eq(companies.id, meetingCompanyId));

      expect(comp!.qualificationStatus).toBe("QUALIFIED");
      expect(comp!.dealStage).toBe("MEETING_BOOKED");
      expect(comp!.status).toBe("MEETING_BOOKED");
    });

    it("updateMeetingOutcome (ATTENDED with QUALIFIED) advances deal to DISCOVERY stage", async () => {
      const res = await updateMeetingOutcome(handle.db, {
        meetingId,
        status: "ATTENDED",
        outcome: "QUALIFIED",
        outcomeNotes: "Great conversation. Need automated quote generator.",
        actor: "Founder",
      });

      expect(res.ok).toBe(true);

      const [comp] = await handle.db
        .select()
        .from(companies)
        .where(eq(companies.id, meetingCompanyId));

      expect(comp!.dealStage).toBe("DISCOVERY");
      expect(comp!.qualificationStatus).toBe("QUALIFIED");
      expect(comp!.status).toBe("DISCOVERY");
    });

    it("updateMeetingOutcome (ATTENDED with PROPOSAL_SENT) advances deal to PROPOSAL stage", async () => {
      const res = await updateMeetingOutcome(handle.db, {
        meetingId,
        status: "ATTENDED",
        outcome: "PROPOSAL_SENT",
        outcomeNotes: "Sent custom pricing tier proposal.",
        actor: "Founder",
      });

      expect(res.ok).toBe(true);

      const [comp] = await handle.db
        .select()
        .from(companies)
        .where(eq(companies.id, meetingCompanyId));

      expect(comp!.dealStage).toBe("PROPOSAL");
      expect(comp!.status).toBe("PROPOSAL");
    });
  });

  describe("4. Manual Deal Stage Management (updateCompanyDealStage)", () => {
    it("allows manual stage advancement with contract value and notes", async () => {
      const res = await updateCompanyDealStage(handle.db, {
        companyId: testCompanyId,
        dealStage: "NEGOTIATION",
        dealValueUsd: 18000,
        actor: "Executive Founder",
        notes: "Redlining contract terms and SLA guarantees",
      });

      expect(res.ok).toBe(true);

      const [comp] = await handle.db
        .select()
        .from(companies)
        .where(eq(companies.id, testCompanyId));

      expect(comp!.dealStage).toBe("NEGOTIATION");
      expect(comp!.qualificationStatus).toBe("QUALIFIED");
      expect(comp!.status).toBe("PILOT");
      expect(comp!.dealValueUsd).toBe(18000);
      expect(comp!.notes).toContain("Stage changed from CLOSED_LOST to NEGOTIATION");
      expect(comp!.notes).toContain("Deal Value: $18,000");
    });

    it("marks deal as CLOSED_WON and sets lifecycle status = CLOSED", async () => {
      const res = await updateCompanyDealStage(handle.db, {
        companyId: testCompanyId,
        dealStage: "CLOSED_WON",
        actor: "Executive Founder",
        notes: "Contract signed! $18k annual subscription.",
      });

      expect(res.ok).toBe(true);

      const [comp] = await handle.db
        .select()
        .from(companies)
        .where(eq(companies.id, testCompanyId));

      expect(comp!.dealStage).toBe("CLOSED_WON");
      expect(comp!.status).toBe("CLOSED");
      expect(comp!.qualificationStatus).toBe("QUALIFIED");
    });
  });

  describe("5. Unified Company Timeline", () => {
    it("retrieves unified chronological events across calls, meetings, tasks, and audit logs", async () => {
      const timeline = await getUnifiedCompanyTimeline(handle.db, testCompanyId);

      expect(timeline.length).toBeGreaterThan(0);

      // Verify descending order by timestamp
      for (let i = 0; i < timeline.length - 1; i++) {
        const tA = new Date(timeline[i]!.timestamp).getTime();
        const tB = new Date(timeline[i + 1]!.timestamp).getTime();
        expect(tA).toBeGreaterThanOrEqual(tB);
      }

      // Verify presence of call and audit event types
      const types = new Set(timeline.map((e) => e.type));
      expect(types.has("call")).toBe(true);
      expect(types.has("audit")).toBe(true);

      // Check event structure
      const first = timeline[0]!;
      expect(first.id).toBeDefined();
      expect(first.title).toBeDefined();
      expect(first.actor).toBeDefined();
      expect(first.timestamp).toBeDefined();
    });
  });

  describe("6. Commercial Pipeline Analytics", () => {
    it("aggregates dealStageCounts and active pipeline values", () => {
      const sampleLeads: FunnelLead[] = [
        {
          id: "c1",
          name: "Alpha Corp",
          state: "TX",
          status: "MEETING_BOOKED",
          notes: null,
          icpScore: 90,
          assignedMemberId: "m1",
          createdAtMs: Date.now() - 10000,
          dealStage: "MEETING_BOOKED",
          dealValueUsd: 12000,
        },
        {
          id: "c2",
          name: "Beta LLC",
          state: "CA",
          status: "DISCOVERY",
          notes: null,
          icpScore: 85,
          assignedMemberId: "m1",
          createdAtMs: Date.now() - 20000,
          dealStage: "DISCOVERY",
          dealValueUsd: 15000,
        },
        {
          id: "c3",
          name: "Gamma Inc",
          state: "FL",
          status: "CLOSED",
          notes: null,
          icpScore: 95,
          assignedMemberId: "m1",
          createdAtMs: Date.now() - 30000,
          dealStage: "CLOSED_WON",
          dealValueUsd: 25000,
        },
        {
          id: "c4",
          name: "Delta Co",
          state: "NY",
          status: "LOST",
          notes: null,
          icpScore: 70,
          assignedMemberId: "m1",
          createdAtMs: Date.now() - 40000,
          dealStage: "CLOSED_LOST",
          dealValueUsd: 10000,
        },
      ];

      const res = computeFunnel(sampleLeads, [], [], {
        scope: "ALL",
        timeframe: "ALL",
        nowMs: Date.now(),
      });

      expect(res.dealStageCounts.MEETING_BOOKED).toBe(1);
      expect(res.dealStageCounts.DISCOVERY).toBe(1);
      expect(res.dealStageCounts.CLOSED_WON).toBe(1);
      expect(res.dealStageCounts.CLOSED_LOST).toBe(1);
      expect(res.activeDealCount).toBe(2); // MEETING_BOOKED + DISCOVERY
      expect(res.totalDealValueUsd).toBe(27000); // 12000 + 15000
    });
  });
});
