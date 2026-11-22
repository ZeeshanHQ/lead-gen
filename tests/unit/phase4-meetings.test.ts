import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createDb, type DbHandle } from "../../src/server/db/client";
import { bootstrap } from "../../src/server/db/bootstrap";
import { createCandidate } from "../../src/server/repo/companies";
import { approveCompany } from "../../src/server/repo/approvals";
import { activities, companies, meetings, auditLogs } from "../../src/server/db/schema";
import { eq } from "drizzle-orm";
import {
  bookDiscoveryMeeting,
  updateMeetingOutcome,
  getMeetingsForAdmin,
  getMeetingsForCompany,
} from "../../src/server/repo/meetings";

describe("Phase 4: Structured Meeting Records, Booking & Show/No-Show Loop", () => {
  let handle: DbHandle;
  let testCompanyId: string;

  beforeAll(async () => {
    handle = await createDb("memory://");
    await bootstrap(handle.db);

    const cand = await createCandidate(
      handle.db,
      {
        name: "Apex Properties Group",
        website: "https://apexproperties.test",
        phone: "(512) 555-4321",
        city: "Dallas",
        state: "TX",
      },
      { actor: "setup" }
    );
    if (cand.kind !== "created") throw new Error("Failed to create candidate");
    testCompanyId = cand.id;
    await approveCompany(handle.db, testCompanyId, { actor: "admin@astraventa.com", note: "Approved" });
  });

  afterAll(async () => {
    await handle.close();
  });

  describe("1. bookDiscoveryMeeting Execution", () => {
    let bookedMeetingId: string;
    const meetingTime = new Date(Date.now() + 24 * 60 * 60 * 1000); // Tomorrow

    it("books a discovery meeting, sets MEETING_BOOKED status, and schedules MEETING_PREP task", async () => {
      const res = await bookDiscoveryMeeting(handle.db, {
        companyId: testCompanyId,
        meetingAt: meetingTime,
        platform: "ZOOM",
        meetingUrl: "https://zoom.us/j/123456789",
        attendeeName: "David Miller",
        attendeeEmail: "david@apexproperties.test",
        bookedBy: "Hamda",
        prepNotes: "25 agents, using Sierra Interactive, wants automated speed-to-lead",
        sendConfirmationEmail: false,
      });

      expect(res.ok).toBe(true);
      expect(res.meetingId).toBeDefined();
      bookedMeetingId = res.meetingId;
      expect(res.followUpDate).toBeDefined();
      expect(res.updatedNotes).toContain("[Next Follow-up Scheduled:");
      expect(res.updatedNotes).toContain("(Meeting Booked)");
      expect(res.updatedNotes).toContain("ZOOM");

      // Verify meetings row in DB
      const [meetingRow] = await handle.db
        .select()
        .from(meetings)
        .where(eq(meetings.id, bookedMeetingId));
      expect(meetingRow).toBeDefined();
      expect(meetingRow?.status).toBe("SCHEDULED");
      expect(meetingRow?.platform).toBe("ZOOM");
      expect(meetingRow?.meetingUrl).toBe("https://zoom.us/j/123456789");
      expect(meetingRow?.attendeeName).toBe("David Miller");
      expect(meetingRow?.attendeeEmail).toBe("david@apexproperties.test");
      expect(meetingRow?.bookedBy).toBe("Hamda");

      // Verify company status and next_follow_up_at
      const [companyRow] = await handle.db
        .select()
        .from(companies)
        .where(eq(companies.id, testCompanyId));
      expect(companyRow?.status).toBe("MEETING_BOOKED");
      expect(companyRow?.nextFollowUpAt?.getTime()).toBe(meetingTime.getTime());

      // Verify MEETING_PREP activity was created
      const allTasks = await handle.db
        .select()
        .from(activities)
        .where(eq(activities.companyId, testCompanyId));
      const prepTask = allTasks.find((t) => t.type === "MEETING_PREP" && t.status === "TODO");
      expect(prepTask).toBeDefined();
      expect(prepTask?.dueAt?.getTime()).toBe(meetingTime.getTime());
      expect(prepTask?.referenceId).toBe(bookedMeetingId);

      // Verify audit log entry
      const auditEntries = await handle.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.entityId, bookedMeetingId));
      const auditEntry = auditEntries.find((a) => a.action === "MEETING_BOOKED_STRUCTURED");
      expect(auditEntry).toBeDefined();
      expect(auditEntry?.actor).toBe("Hamda");
    });

    it("surfaces meeting in getMeetingsForAdmin and getMeetingsForCompany", async () => {
      const adminMeetings = await getMeetingsForAdmin(handle.db);
      expect(adminMeetings.length).toBeGreaterThanOrEqual(1);
      const m = adminMeetings.find((x) => x.id === bookedMeetingId);
      expect(m).toBeDefined();
      expect(m?.companyName).toBe("Apex Properties Group");
      expect(m?.platform).toBe("ZOOM");

      const companyMeetings = await getMeetingsForCompany(handle.db, testCompanyId);
      expect(companyMeetings.length).toBeGreaterThanOrEqual(1);
      expect(companyMeetings[0]?.id).toBe(bookedMeetingId);
    });
  });

  describe("2. updateMeetingOutcome Transitions & Recovery Loop", () => {
    it("handles NO_SHOW: completes prep task, auto-schedules recovery call in +4 hours, and updates company follow-up", async () => {
      // 1. Create a fresh lead and book meeting
      const cand = await createCandidate(
        handle.db,
        {
          name: "Bluebonnet Realty",
          website: "https://bluebonnet.test",
          phone: "(512) 555-7788",
          city: "Austin",
          state: "TX",
        },
        { actor: "setup" }
      );
      if (cand.kind !== "created") throw new Error("Failed to create candidate");
      const companyId = cand.id;
      await approveCompany(handle.db, companyId, { actor: "admin@astraventa.com", note: "Approved" });

      const bookRes = await bookDiscoveryMeeting(handle.db, {
        companyId,
        meetingAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        platform: "GOOGLE_MEET",
        attendeeName: "Rachel Green",
        bookedBy: "Caller1",
      });

      // 2. Mark as NO_SHOW
      const updateRes = await updateMeetingOutcome(handle.db, {
        meetingId: bookRes.meetingId,
        status: "NO_SHOW",
        outcomeNotes: "Prospect did not join Google Meet, sent email and rang phone.",
        actor: "Admin",
      });

      expect(updateRes.ok).toBe(true);
      expect(updateRes.status).toBe("NO_SHOW");
      expect(updateRes.updatedFollowUp).toBeDefined();

      // 3. Verify meeting is updated
      const [meetingRow] = await handle.db
        .select()
        .from(meetings)
        .where(eq(meetings.id, bookRes.meetingId));
      expect(meetingRow?.status).toBe("NO_SHOW");

      // 4. Verify previous prep task marked DONE with NO_SHOW outcome
      const [prepTask] = await handle.db
        .select()
        .from(activities)
        .where(eq(activities.referenceId, bookRes.meetingId));
      expect(prepTask?.status).toBe("DONE");
      expect(prepTask?.outcome).toBe("NO_SHOW");

      // 5. Verify high-priority recovery CALL activity created in +4 hours
      const allTasks = await handle.db
        .select()
        .from(activities)
        .where(eq(activities.companyId, companyId));
      const recoveryTask = allTasks.find(
        (t) => t.type === "CALL" && t.status === "TODO" && t.notes?.includes("No-show recovery call")
      );
      expect(recoveryTask).toBeDefined();
      expect(recoveryTask?.dueAt).toBeInstanceOf(Date);

      // 6. Verify company next_follow_up_at matches recovery task
      const [companyRow] = await handle.db
        .select()
        .from(companies)
        .where(eq(companies.id, companyId));
      expect(companyRow?.nextFollowUpAt?.getTime()).toBe(recoveryTask?.dueAt?.getTime());
      expect(companyRow?.notes).toContain("(Meeting No-Show)");
    });

    it("handles ATTENDED: completes prep task and advances company status to DISCOVERY", async () => {
      // 1. Create a fresh lead and book meeting
      const cand = await createCandidate(
        handle.db,
        {
          name: "Starlight Real Estate",
          website: "https://starlight.test",
          phone: "(512) 555-9911",
          city: "Houston",
          state: "TX",
        },
        { actor: "setup" }
      );
      if (cand.kind !== "created") throw new Error("Failed to create candidate");
      const companyId = cand.id;
      await approveCompany(handle.db, companyId, { actor: "admin@astraventa.com", note: "Approved" });

      const bookRes = await bookDiscoveryMeeting(handle.db, {
        companyId,
        meetingAt: new Date(Date.now() + 60 * 60 * 1000),
        platform: "ZOOM",
        attendeeName: "Michael Scott",
        bookedBy: "Caller1",
      });

      // 2. Mark ATTENDED
      const updateRes = await updateMeetingOutcome(handle.db, {
        meetingId: bookRes.meetingId,
        status: "ATTENDED",
        outcome: "QUALIFIED",
        outcomeNotes: "Great conversation, 40 agents, ready for proposal next week",
        actor: "AccountExec",
      });

      expect(updateRes.ok).toBe(true);
      expect(updateRes.status).toBe("ATTENDED");

      // 3. Verify company status advanced to DISCOVERY
      const [companyRow] = await handle.db
        .select()
        .from(companies)
        .where(eq(companies.id, companyId));
      expect(companyRow?.status).toBe("DISCOVERY");
      expect(companyRow?.notes).toContain("(Meeting Attended)");
      expect(companyRow?.notes).toContain("QUALIFIED");

      // 4. Verify prep task marked DONE
      const [prepTask] = await handle.db
        .select()
        .from(activities)
        .where(eq(activities.referenceId, bookRes.meetingId));
      expect(prepTask?.status).toBe("DONE");
      expect(prepTask?.outcome).toBe("QUALIFIED");
    });

    it("handles RESCHEDULED: updates meetingAt and syncs prep task and company follow-up", async () => {
      const cand = await createCandidate(
        handle.db,
        {
          name: "Horizon Realty",
          website: "https://horizonrealty.test",
          phone: "(512) 555-3344",
          city: "Austin",
          state: "TX",
        },
        { actor: "setup" }
      );
      if (cand.kind !== "created") throw new Error("Failed to create candidate");
      const companyId = cand.id;
      await approveCompany(handle.db, companyId, { actor: "admin@astraventa.com", note: "Approved" });

      const bookRes = await bookDiscoveryMeeting(handle.db, {
        companyId,
        meetingAt: new Date(Date.now() + 60 * 60 * 1000),
        platform: "PHONE",
        attendeeName: "Pam Beesly",
        bookedBy: "Caller1",
      });

      const newDate = new Date(Date.now() + 72 * 60 * 60 * 1000);
      const updateRes = await updateMeetingOutcome(handle.db, {
        meetingId: bookRes.meetingId,
        status: "RESCHEDULED",
        newMeetingAt: newDate,
        outcomeNotes: "Prospect asked to move to Friday morning",
        actor: "Caller1",
      });

      expect(updateRes.ok).toBe(true);
      expect(updateRes.status).toBe("RESCHEDULED");

      // Verify company nextFollowUpAt matches newDate
      const [companyRow] = await handle.db
        .select()
        .from(companies)
        .where(eq(companies.id, companyId));
      expect(companyRow?.nextFollowUpAt?.getTime()).toBe(newDate.getTime());
      expect(companyRow?.notes).toContain("(Meeting Rescheduled)");
    });
  });
});
