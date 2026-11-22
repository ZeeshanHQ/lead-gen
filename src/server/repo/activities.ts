import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { activities, companies, dncSuggestions, meetings, type ActivityStatus, type ActivityType } from "../db/schema";
import type { LifecycleStatus } from "../domain/lifecycle";

export interface CreateActivityInput {
  companyId: string;
  type: ActivityType;
  status?: ActivityStatus;
  dueAt?: Date | null;
  completedAt?: Date | null;
  assignedMemberId?: string | null;
  assignedMemberName?: string | null;
  outcome?: string | null;
  notes?: string | null;
  referenceId?: string | null;
}

export interface ActivityRecord {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  status: ActivityStatus;
  companyId: string;
  type: ActivityType;
  dueAt: Date | null;
  completedAt: Date | null;
  assignedMemberId: string | null;
  assignedMemberName: string | null;
  outcome: string | null;
  notes: string | null;
  referenceId: string | null;
}

const OPEN_STATUSES: ActivityStatus[] = ["TODO", "IN_PROGRESS", "OVERDUE"];

/**
 * Creates a single activity / task.
 */
export async function createActivity(
  db: Db,
  input: CreateActivityInput
): Promise<ActivityRecord> {
  const [created] = await db
    .insert(activities)
    .values({
      companyId: input.companyId,
      type: input.type,
      status: input.status || "TODO",
      dueAt: input.dueAt || null,
      completedAt: input.completedAt || null,
      assignedMemberId: input.assignedMemberId || null,
      assignedMemberName: input.assignedMemberName || null,
      outcome: input.outcome || null,
      notes: input.notes || null,
      referenceId: input.referenceId || null,
    })
    .returning();

  return created as ActivityRecord;
}

/**
 * Completes all open activities for a company with DONE status and recorded outcome.
 */
export async function completeOpenActivitiesForCompany(
  db: Db,
  companyId: string,
  opts?: { outcome?: string | null; notes?: string | null; completedAt?: Date }
): Promise<number> {
  const completedAt = opts?.completedAt ?? new Date();
  const res = await db
    .update(activities)
    .set({
      status: "DONE",
      completedAt,
      outcome: opts?.outcome || null,
      ...(opts?.notes ? { notes: opts.notes } : {}),
      updatedAt: completedAt,
    })
    .where(
      and(
        eq(activities.companyId, companyId),
        inArray(activities.status, OPEN_STATUSES)
      )
    );

  return (res as any)?.rowCount ?? 1;
}

/**
 * Marks open activities as SKIPPED (e.g., when lead is disqualified or lost).
 */
export async function skipOpenActivitiesForCompany(
  db: Db,
  companyId: string,
  reason?: string | null
): Promise<void> {
  const now = new Date();
  await db
    .update(activities)
    .set({
      status: "SKIPPED",
      completedAt: now,
      notes: reason || "Skipped due to lead stage transition",
      updatedAt: now,
    })
    .where(
      and(
        eq(activities.companyId, companyId),
        inArray(activities.status, OPEN_STATUSES)
      )
    );
}

/**
 * Reassigns open activities when a lead is reassigned to another caller or unassigned.
 */
export async function reassignOpenActivities(
  db: Db,
  companyIds: string | string[],
  newMemberId: string | null,
  newMemberName: string | null
): Promise<void> {
  const ids = Array.isArray(companyIds) ? companyIds : [companyIds];
  if (ids.length === 0) return;

  await db
    .update(activities)
    .set({
      assignedMemberId: newMemberId || null,
      assignedMemberName: newMemberName || null,
      updatedAt: new Date(),
    })
    .where(
      and(
        inArray(activities.companyId, ids),
        inArray(activities.status, OPEN_STATUSES)
      )
    );
}

/**
 * Updates the due_at of open activities for a company (e.g., when follow-up is rescheduled).
 */
export async function syncActivityDueAt(
  db: Db,
  companyId: string,
  newDueAt: Date | null
): Promise<void> {
  await db
    .update(activities)
    .set({
      dueAt: newDueAt,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(activities.companyId, companyId),
        inArray(activities.status, OPEN_STATUSES)
      )
    );
}

/**
 * Ensures a lead has a mandatory task when assigned to a caller:
 * If an open task exists, reassigns it to the new caller.
 * If no open task exists, creates a CALL task due within 4 hours (or at existing nextFollowUpAt).
 */
export async function ensureAssignmentTask(
  db: Db,
  params: {
    companyId: string;
    memberId: string | null;
    memberName: string | null;
    actor?: string;
  }
): Promise<ActivityRecord | null> {
  const { companyId, memberId, memberName } = params;

  // 1. If unassigning, clear open activity assignments
  if (!memberId) {
    await reassignOpenActivities(db, companyId, null, null);
    return null;
  }

  // 2. Check for existing open task
  const [existingOpen] = await db
    .select()
    .from(activities)
    .where(
      and(
        eq(activities.companyId, companyId),
        inArray(activities.status, OPEN_STATUSES)
      )
    )
    .limit(1);

  if (existingOpen) {
    await db
      .update(activities)
      .set({
        assignedMemberId: memberId,
        assignedMemberName: memberName || null,
        updatedAt: new Date(),
      })
      .where(eq(activities.id, existingOpen.id));
    return { ...existingOpen, assignedMemberId: memberId, assignedMemberName: memberName || null } as ActivityRecord;
  }

  // 3. Lead has no open task: retrieve company to inspect follow-up timestamp
  const [company] = await db
    .select({
      id: companies.id,
      nextFollowUpAt: companies.nextFollowUpAt,
      status: companies.status,
    })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);

  if (!company) return null;

  // Default to 4 hours from now if no follow-up is scheduled
  const defaultDue = new Date(Date.now() + 4 * 60 * 60 * 1000);
  const taskDue = company.nextFollowUpAt || defaultDue;

  // Also ensure companies.next_follow_up_at is populated
  if (!company.nextFollowUpAt) {
    await db
      .update(companies)
      .set({ nextFollowUpAt: taskDue, updatedAt: new Date() })
      .where(eq(companies.id, companyId));
  }

  return await createActivity(db, {
    companyId,
    type: "CALL",
    status: "TODO",
    dueAt: taskDue,
    assignedMemberId: memberId,
    assignedMemberName: memberName || null,
    notes: `Initial contact task assigned to ${memberName || "caller"}.`,
  });
}

/**
 * Automatically syncs the next activity based on call feedback / outcome.
 */
export async function syncNextActivityForCompany(
  db: Db,
  params: {
    companyId: string;
    outcome: string;
    nextStatus: LifecycleStatus | string;
    followUpDate: Date | null;
    assignedMemberId?: string | null;
    assignedMemberName?: string | null;
    callerNotes?: string | null;
    actor?: string;
  }
): Promise<ActivityRecord | null> {
  const { companyId, outcome, nextStatus, followUpDate, assignedMemberId, assignedMemberName } = params;

  const terminalOutcomes = new Set([
    "NOT_INTERESTED",
    "WRONG_NUMBER",
    "DISQUALIFIED",
    "DO_NOT_CALL",
  ]);
  const terminalStatuses = new Set(["NOT_INTERESTED", "DISQUALIFIED", "LOST", "CLOSED"]);

  // 1. Terminal outcomes -> mark open activities as SKIPPED and do not schedule a new task
  if (terminalOutcomes.has(outcome) || terminalStatuses.has(nextStatus)) {
    await skipOpenActivitiesForCompany(db, companyId, `Terminal outcome recorded: ${outcome}`);
    return null;
  }

  // 2. Non-terminal: complete existing open tasks for this company as DONE
  await completeOpenActivitiesForCompany(db, companyId, {
    outcome,
    notes: params.callerNotes,
    completedAt: new Date(),
  });

  // 3. Determine next activity type and due date
  let nextType: ActivityType = "CALL";
  let dueAt: Date = followUpDate || new Date(Date.now() + 4 * 60 * 60 * 1000);
  let taskNotes: string | null = null;

  if (outcome === "EMAIL_REQUESTED") {
    nextType = "EMAIL";
    // Prompt caller to send email within 2 hours
    dueAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
    taskNotes = "Send requested company information/deck by email.";
  } else if (outcome === "MEETING_BOOKED" || nextStatus === "MEETING_BOOKED") {
    nextType = "MEETING_PREP";
    dueAt = followUpDate || new Date(Date.now() + 24 * 60 * 60 * 1000);
    taskNotes = "Prepare discovery meeting notes and review prospect facts.";
  } else {
    nextType = "CALL";
    taskNotes = `Follow-up call: outcome was ${outcome}.`;
  }

  return await createActivity(db, {
    companyId,
    type: nextType,
    status: "TODO",
    dueAt,
    assignedMemberId: assignedMemberId || null,
    assignedMemberName: assignedMemberName || null,
    notes: taskNotes,
  });
}

// ---------------------------------------------------------------------------
// Admin Operations Monitoring Metrics
// ---------------------------------------------------------------------------

export interface OverdueTaskMetric {
  id: string;
  activityType: ActivityType;
  dueAt: Date | null;
  overdueHours: number;
  companyId: string;
  companyName: string;
  phoneDisplay: string | null;
  state: string | null;
  assignedMemberId: string | null;
  assignedMemberName: string | null;
  notes: string | null;
}

export interface OverdueCallerGroup {
  memberId: string;
  memberName: string;
  count: number;
}

export interface UnassignedLeadMetric {
  id: string;
  name: string;
  phoneDisplay: string | null;
  state: string | null;
  approvedAt: Date | null;
  status: string;
}

export interface StaleLeadMetric {
  id: string;
  name: string;
  status: string;
  phoneDisplay: string | null;
  assignedMemberName: string | null;
  updatedAt: Date;
  daysSilent: number;
}

export interface UpcomingMeetingMetric {
  id: string;
  companyId: string;
  companyName: string;
  phoneDisplay: string | null;
  assignedMemberName: string | null;
  scheduledAt: Date | null;
  notes: string | null;
  meetingId?: string | null;
  platform?: string | null;
  meetingUrl?: string | null;
  attendeeName?: string | null;
  attendeeEmail?: string | null;
  bookedBy?: string | null;
  prepNotes?: string | null;
  meetingStatus?: string | null;
}

export interface AdminMonitorMetrics {
  overdueTasks: OverdueTaskMetric[];
  overdueByCaller: OverdueCallerGroup[];
  unassignedApprovedLeads: UnassignedLeadMetric[];
  staleActiveLeads: StaleLeadMetric[];
  upcomingMeetings: UpcomingMeetingMetric[];
  pipelineCounts: Record<string, number>;
  totalOverdueCount: number;
  totalUnassignedCount: number;
  totalStaleCount: number;
  totalMeetingsCount: number;
  pendingDncCount?: number;
}

/**
 * Returns comprehensive operational metrics for `/admin/monitor`.
 */
export async function getAdminMonitorMetrics(
  db: Db,
  marketId?: string | null
): Promise<AdminMonitorMetrics> {
  const now = new Date();
  const marketFilter = marketId && marketId.trim() !== "" ? eq(companies.marketId, marketId) : undefined;

  // 1. Overdue tasks: status in (TODO, IN_PROGRESS, OVERDUE) and due_at < now()
  const overdueConditions = [
    inArray(activities.status, OPEN_STATUSES),
    lt(activities.dueAt, now),
  ];
  if (marketFilter) overdueConditions.push(marketFilter);

  const rawOverdue = await db
    .select({
      id: activities.id,
      activityType: activities.type,
      dueAt: activities.dueAt,
      assignedMemberId: activities.assignedMemberId,
      assignedMemberName: activities.assignedMemberName,
      notes: activities.notes,
      companyId: companies.id,
      companyName: companies.name,
      phoneDisplay: companies.phoneDisplay,
      state: companies.state,
    })
    .from(activities)
    .innerJoin(companies, eq(activities.companyId, companies.id))
    .where(and(...overdueConditions))
    .orderBy(activities.dueAt)
    .limit(200);

  const overdueTasks: OverdueTaskMetric[] = rawOverdue.map((r) => {
    const dueMs = r.dueAt ? r.dueAt.getTime() : now.getTime();
    const overdueHours = Math.max(0, Math.round((now.getTime() - dueMs) / (1000 * 60 * 60)));
    return {
      id: r.id,
      activityType: r.activityType as ActivityType,
      dueAt: r.dueAt,
      overdueHours,
      companyId: r.companyId,
      companyName: r.companyName,
      phoneDisplay: r.phoneDisplay,
      state: r.state,
      assignedMemberId: r.assignedMemberId,
      assignedMemberName: r.assignedMemberName,
      notes: r.notes,
    };
  });

  // Aggregate overdue by caller
  const callerMap = new Map<string, { memberId: string; memberName: string; count: number }>();
  for (const t of overdueTasks) {
    const key = t.assignedMemberId || "unassigned";
    const name = t.assignedMemberName || "Unassigned";
    const existing = callerMap.get(key) || { memberId: key, memberName: name, count: 0 };
    existing.count++;
    callerMap.set(key, existing);
  }
  const overdueByCaller = Array.from(callerMap.values()).sort((a, b) => b.count - a.count);

  // 2. Approved & Unassigned leads: status = 'APPROVED' and assigned_member_id is null
  const unassignedConditions = [
    eq(companies.status, "APPROVED"),
    or(isNull(companies.assignedMemberId), eq(companies.assignedMemberId, "")),
  ];
  if (marketFilter) unassignedConditions.push(marketFilter);

  const unassignedApprovedLeads: UnassignedLeadMetric[] = await db
    .select({
      id: companies.id,
      name: companies.name,
      phoneDisplay: companies.phoneDisplay,
      state: companies.state,
      approvedAt: companies.approvedAt,
      status: companies.status,
    })
    .from(companies)
    .where(and(...unassignedConditions))
    .orderBy(desc(companies.approvedAt))
    .limit(100);

  // 3. Stale Active Leads: status in ('CALLING', 'CONNECTED', 'PAIN_FOUND', 'QUALIFIED') and updated_at < 7 days ago
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const staleConditions = [
    inArray(companies.status, ["CALLING", "CONNECTED", "PAIN_FOUND", "QUALIFIED"]),
    lt(companies.updatedAt, sevenDaysAgo),
  ];
  if (marketFilter) staleConditions.push(marketFilter);

  const rawStale = await db
    .select({
      id: companies.id,
      name: companies.name,
      status: companies.status,
      phoneDisplay: companies.phoneDisplay,
      assignedMemberName: companies.assignedMemberName,
      updatedAt: companies.updatedAt,
    })
    .from(companies)
    .where(and(...staleConditions))
    .orderBy(companies.updatedAt)
    .limit(100);

  const staleActiveLeads: StaleLeadMetric[] = rawStale.map((r) => {
    const diffDays = Math.max(7, Math.floor((now.getTime() - r.updatedAt.getTime()) / (1000 * 60 * 60 * 24)));
    return {
      id: r.id,
      name: r.name,
      status: r.status,
      phoneDisplay: r.phoneDisplay,
      assignedMemberName: r.assignedMemberName,
      updatedAt: r.updatedAt,
      daysSilent: diffDays,
    };
  });

  // 4. Upcoming / Today's meetings: leads with status = 'MEETING_BOOKED'
  const meetingConditions = [eq(companies.status, "MEETING_BOOKED")];
  if (marketFilter) meetingConditions.push(marketFilter);

  const rawMeetings = await db
    .select({
      id: companies.id,
      companyId: companies.id,
      companyName: companies.name,
      phoneDisplay: companies.phoneDisplay,
      assignedMemberName: companies.assignedMemberName,
      scheduledAt: companies.nextFollowUpAt,
      notes: companies.notes,
      meetingId: meetings.id,
      platform: meetings.platform,
      meetingUrl: meetings.meetingUrl,
      attendeeName: meetings.attendeeName,
      attendeeEmail: meetings.attendeeEmail,
      bookedBy: meetings.bookedBy,
      prepNotes: meetings.prepNotes,
      meetingStatus: meetings.status,
    })
    .from(companies)
    .leftJoin(meetings, eq(companies.id, meetings.companyId))
    .where(and(...meetingConditions))
    .orderBy(desc(meetings.createdAt), companies.nextFollowUpAt)
    .limit(100);

  const seenCompanies = new Set<string>();
  const upcomingMeetings: UpcomingMeetingMetric[] = [];
  for (const m of rawMeetings) {
    if (!seenCompanies.has(m.companyId)) {
      seenCompanies.add(m.companyId);
      upcomingMeetings.push({
        id: m.meetingId || m.id,
        meetingId: m.meetingId || null,
        companyId: m.companyId,
        companyName: m.companyName,
        phoneDisplay: m.phoneDisplay,
        assignedMemberName: m.assignedMemberName,
        scheduledAt: m.scheduledAt,
        notes: m.notes,
        platform: m.platform || null,
        meetingUrl: m.meetingUrl || null,
        attendeeName: m.attendeeName || null,
        attendeeEmail: m.attendeeEmail || null,
        bookedBy: m.bookedBy || null,
        prepNotes: m.prepNotes || null,
        meetingStatus: m.meetingStatus || null,
      });
    }
  }

  // 5. Pipeline Counts across companies.status
  const pipelineRows = await db
    .select({
      status: companies.status,
      count: sql<number>`count(*)::int`,
    })
    .from(companies)
    .where(marketFilter ? and(marketFilter) : undefined)
    .groupBy(companies.status);

  const pipelineCounts: Record<string, number> = {};
  for (const row of pipelineRows) {
    pipelineCounts[row.status] = Number(row.count) || 0;
  }

  // Phase 5: Pending DNC suggestions count
  const [dncRes] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(dncSuggestions)
    .where(eq(dncSuggestions.status, "PENDING"));
  const pendingDncCount = Number(dncRes?.count || 0);

  return {
    overdueTasks,
    overdueByCaller,
    unassignedApprovedLeads,
    staleActiveLeads,
    upcomingMeetings,
    pipelineCounts,
    totalOverdueCount: overdueTasks.length,
    totalUnassignedCount: unassignedApprovedLeads.length,
    totalStaleCount: staleActiveLeads.length,
    totalMeetingsCount: upcomingMeetings.length,
    pendingDncCount,
  };
}
