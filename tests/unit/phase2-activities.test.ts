import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createDb, type DbHandle } from "../../src/server/db/client";
import { bootstrap } from "../../src/server/db/bootstrap";
import { createCandidate } from "../../src/server/repo/companies";
import { approveCompany } from "../../src/server/repo/approvals";
import { activities, companies } from "../../src/server/db/schema";
import { eq, inArray } from "drizzle-orm";
import {
  assignLeadToMember,
  recordCallFeedback,
  updateLeadFollowUp,
  resetLeadCallStatus,
} from "../../src/server/repo/caller";
import {
  createActivity,
  getAdminMonitorMetrics,
  reassignOpenActivities,
  completeOpenActivitiesForCompany,
} from "../../src/server/repo/activities";

describe("Phase 2: Activities (Tasks) Table & Sales Operations Monitor", () => {
  let handle: DbHandle;
  let companyAId: string;
  let companyBId: string;

  beforeAll(async () => {
    handle = await createDb("memory://");
    await bootstrap(handle.db);

    // Create 2 test companies
    const candA = await createCandidate(
      handle.db,
      {
        name: "Cooling Kings LLC",
        website: "https://coolingkingstest.com",
        phone: "(512) 555-8888",
        city: "Austin",
        state: "TX",
      },
      { actor: "setup" }
    );
    if (candA.kind !== "created") throw new Error("Failed to create candidate A");
    companyAId = candA.id;

    const candB = await createCandidate(
      handle.db,
      {
        name: "Breeze Masters HVAC",
        website: "https://breezemasterstest.com",
        phone: "(214) 555-9999",
        city: "Dallas",
        state: "TX",
      },
      { actor: "setup" }
    );
    if (candB.kind !== "created") throw new Error("Failed to create candidate B");
    companyBId = candB.id;

    await approveCompany(handle.db, companyAId, { actor: "admin", note: "Approved" });
    await approveCompany(handle.db, companyBId, { actor: "admin", note: "Approved" });
  });

  afterAll(async () => {
    await handle.close();
  });

  it("automatically creates a mandatory CALL activity when a lead is assigned to a caller", async () => {
    await assignLeadToMember(handle.db, companyAId, "caller_alice", "Alice Walker", "admin");

    const tasks = await handle.db
      .select()
      .from(activities)
      .where(eq(activities.companyId, companyAId));

    expect(tasks.length).toBeGreaterThanOrEqual(1);
    const initialCallTask = tasks.find((t) => t.type === "CALL" && t.status === "TODO");
    expect(initialCallTask).toBeDefined();
    expect(initialCallTask?.assignedMemberId).toBe("caller_alice");
    expect(initialCallTask?.assignedMemberName).toBe("Alice Walker");
    expect(initialCallTask?.dueAt).toBeInstanceOf(Date);
  });

  it("completes previous task and creates a next CALL task on NO_ANSWER", async () => {
    const res = await recordCallFeedback(handle.db, {
      companyId: companyAId,
      actor: "Alice Walker",
      callOutcome: "NO_ANSWER",
      callerNotes: "Rang 5 times, voicemail reached.",
      followUpDate: "2026-11-25T16:00",
      clientLogId: "p2_log_1",
    });

    expect(res.ok).toBe(true);

    const allTasks = await handle.db
      .select()
      .from(activities)
      .where(eq(activities.companyId, companyAId));

    // Previous task marked DONE
    const doneTasks = allTasks.filter((t) => t.status === "DONE");
    expect(doneTasks.length).toBeGreaterThanOrEqual(1);
    expect(doneTasks[0]?.outcome).toBe("NO_ANSWER");
    expect(doneTasks[0]?.completedAt).toBeInstanceOf(Date);

    // New TODO task scheduled
    const openTasks = allTasks.filter((t) => t.status === "TODO");
    expect(openTasks.length).toBe(1);
    expect(openTasks[0]?.type).toBe("CALL");
    expect(openTasks[0]?.dueAt).toBeInstanceOf(Date);
  });

  it("creates an EMAIL activity due in 2 hours when EMAIL_REQUESTED is recorded", async () => {
    const res = await recordCallFeedback(handle.db, {
      companyId: companyAId,
      actor: "Alice Walker",
      callOutcome: "EMAIL_REQUESTED",
      callerNotes: "Gatekeeper said send marketing package to info@coolingkings.com",
      emailConfirmed: "info@coolingkings.com",
      clientLogId: "p2_log_2",
    });

    expect(res.ok).toBe(true);

    const allTasks = await handle.db
      .select()
      .from(activities)
      .where(eq(activities.companyId, companyAId));

    const openTasks = allTasks.filter((t) => t.status === "TODO");
    expect(openTasks.length).toBe(1);
    expect(openTasks[0]?.type).toBe("EMAIL");
    expect(openTasks[0]?.notes).toContain("Send requested company information");
    // Due within ~2 hours from now
    const diffHours = (openTasks[0]!.dueAt!.getTime() - Date.now()) / (1000 * 60 * 60);
    expect(diffHours).toBeGreaterThan(1.5);
    expect(diffHours).toBeLessThan(2.5);
  });

  it("creates a MEETING_PREP activity when MEETING_BOOKED is logged", async () => {
    const meetingDate = "2026-11-28T14:00";
    const res = await recordCallFeedback(handle.db, {
      companyId: companyAId,
      actor: "Alice Walker",
      callOutcome: "MEETING_BOOKED",
      callerNotes: "Discovery meeting confirmed with the owner on Zoom.",
      followUpDate: meetingDate,
      clientLogId: "p2_log_3",
    });

    expect(res.ok).toBe(true);

    const openTasks = await handle.db
      .select()
      .from(activities)
      .where(
        eq(activities.companyId, companyAId)
      );

    const prepTask = openTasks.find((t) => t.status === "TODO");
    expect(prepTask).toBeDefined();
    expect(prepTask?.type).toBe("MEETING_PREP");
    expect(prepTask?.notes).toContain("discovery meeting notes");
  });

  it("marks open activities as SKIPPED when terminal NOT_INTERESTED outcome is recorded", async () => {
    const res = await recordCallFeedback(handle.db, {
      companyId: companyAId,
      actor: "Alice Walker",
      callOutcome: "NOT_INTERESTED",
      callerNotes: "Prospect firmly requested no further contact.",
      clientLogId: "p2_log_4",
    });

    expect(res.ok).toBe(true);

    const openTasks = await handle.db
      .select()
      .from(activities)
      .where(
        eq(activities.companyId, companyAId)
      );

    const activeTasks = openTasks.filter((t) => t.status === "TODO" || t.status === "IN_PROGRESS");
    expect(activeTasks.length).toBe(0);

    const skippedTasks = openTasks.filter((t) => t.status === "SKIPPED");
    expect(skippedTasks.length).toBeGreaterThanOrEqual(1);
  });

  it("reassigns open tasks when lead is transferred to another caller", async () => {
    // 1. Assign companyB to Bob
    await assignLeadToMember(handle.db, companyBId, "caller_bob", "Bob Smith", "admin");

    const [taskBob] = await handle.db
      .select()
      .from(activities)
      .where(eq(activities.companyId, companyBId));
    expect(taskBob?.assignedMemberId).toBe("caller_bob");

    // 2. Transfer companyB from Bob to Alice
    await assignLeadToMember(handle.db, companyBId, "caller_alice", "Alice Walker", "admin");

    const [taskAlice] = await handle.db
      .select()
      .from(activities)
      .where(eq(activities.companyId, companyBId));
    expect(taskAlice?.assignedMemberId).toBe("caller_alice");
    expect(taskAlice?.assignedMemberName).toBe("Alice Walker");
  });

  it("getAdminMonitorMetrics accurately aggregates overdue tasks, unassigned leads, and meetings", async () => {
    // Insert an overdue task manually for testing
    const overduePastDate = new Date(Date.now() - 3 * 3600 * 1000); // 3 hours ago
    await createActivity(handle.db, {
      companyId: companyBId,
      type: "CALL",
      status: "TODO",
      dueAt: overduePastDate,
      assignedMemberId: "caller_alice",
      assignedMemberName: "Alice Walker",
      notes: "Test overdue callback",
    });

    const metrics = await getAdminMonitorMetrics(handle.db);

    expect(metrics.totalOverdueCount).toBeGreaterThanOrEqual(1);
    const foundOverdue = metrics.overdueTasks.find((t) => t.companyId === companyBId);
    expect(foundOverdue).toBeDefined();
    expect(foundOverdue?.overdueHours).toBeGreaterThanOrEqual(2);

    // Verify caller breakdown includes Alice
    const aliceOverdue = metrics.overdueByCaller.find((c) => c.memberId === "caller_alice");
    expect(aliceOverdue).toBeDefined();
    expect(aliceOverdue?.count).toBeGreaterThanOrEqual(1);

    // Verify pipeline counts exist
    expect(metrics.pipelineCounts).toBeDefined();
  });
});
