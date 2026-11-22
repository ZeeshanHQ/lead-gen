import { desc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import {
  activities,
  auditLogs,
  emailActivities,
  meetings,
} from "../db/schema";

export type TimelineEventType = "call" | "email" | "meeting" | "task" | "audit";

export interface TimelineEvent {
  id: string;
  type: TimelineEventType;
  timestamp: string; // ISO string
  title: string;
  actor: string;
  details?: Record<string, any>;
  status?: string;
  badge?: string;
  notes?: string | null;
}

/**
 * Fetch and merge all company touchpoints into a unified chronological activity timeline.
 * Sorted descending by timestamp.
 */
export async function getUnifiedCompanyTimeline(
  db: Db,
  companyId: string
): Promise<TimelineEvent[]> {
  const events: TimelineEvent[] = [];

  // 1. Fetch Outbound Emails
  try {
    const emails = await db
      .select()
      .from(emailActivities)
      .where(eq(emailActivities.companyId, companyId))
      .orderBy(desc(emailActivities.sentAt));

    for (const em of emails) {
      events.push({
        id: `email-${em.id}`,
        type: "email",
        timestamp: em.sentAt ? new Date(em.sentAt).toISOString() : new Date().toISOString(),
        title: em.subject ? `Email: ${em.subject}` : "Outbound Prospect Email",
        actor: em.actor || "System",
        status: em.status,
        badge: em.templateKey || "EMAIL",
        notes: em.bodyText || null,
        details: {
          recipientEmail: em.recipientEmail,
          templateKey: em.templateKey,
          status: em.status,
        },
      });
    }
  } catch {
    // Non-blocking
  }

  // 2. Fetch Structured Meetings
  try {
    const meetingRows = await db
      .select()
      .from(meetings)
      .where(eq(meetings.companyId, companyId))
      .orderBy(desc(meetings.meetingAt));

    for (const m of meetingRows) {
      events.push({
        id: `meeting-${m.id}`,
        type: "meeting",
        timestamp: m.meetingAt ? new Date(m.meetingAt).toISOString() : new Date().toISOString(),
        title: `Meeting (${m.platform}) - ${m.status}`,
        actor: m.bookedBy || "Caller",
        status: m.status,
        badge: m.platform,
        notes: m.outcomeNotes || m.prepNotes || null,
        details: {
          meetingUrl: m.meetingUrl,
          attendeeName: m.attendeeName,
          attendeeEmail: m.attendeeEmail,
          outcome: m.outcome,
          prepNotes: m.prepNotes,
          outcomeNotes: m.outcomeNotes,
        },
      });
    }
  } catch {
    // Non-blocking
  }

  // 3. Fetch Tasks / Activities
  try {
    const activityRows = await db
      .select()
      .from(activities)
      .where(eq(activities.companyId, companyId))
      .orderBy(desc(activities.createdAt));

    for (const act of activityRows) {
      events.push({
        id: `task-${act.id}`,
        type: "task",
        timestamp: act.createdAt ? new Date(act.createdAt).toISOString() : new Date().toISOString(),
        title: `Task: ${act.type} (${act.status})`,
        actor: act.assignedMemberName || "Assigned Agent",
        status: act.status,
        badge: act.type,
        notes: act.notes || null,
        details: {
          outcome: act.outcome,
          dueAt: act.dueAt ? new Date(act.dueAt).toISOString() : null,
          completedAt: act.completedAt ? new Date(act.completedAt).toISOString() : null,
        },
      });
    }
  } catch {
    // Non-blocking
  }

  // 4. Fetch Audit Logs
  try {
    const logs = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.companyId, companyId))
      .orderBy(desc(auditLogs.createdAt))
      .limit(100);

    for (const log of logs) {
      const details = (log.details as Record<string, any>) || {};
      const action = log.action;

      if (action === "caller.call_logged") {
        events.push({
          id: `audit-${log.id}`,
          type: "call",
          timestamp: log.createdAt ? new Date(log.createdAt).toISOString() : new Date().toISOString(),
          title: `Call: ${details.callOutcome || "Logged"}`,
          actor: log.actor || "Caller",
          status: details.callOutcome || "CONNECTED",
          badge: details.callOutcome || "CALL",
          notes: details.notes || details.callerNotes || null,
          details,
        });
      } else {
        let title = `Audit: ${action}`;
        if (action === "company.deal_stage_updated") {
          title = `Stage Changed: ${details.previousStage} → ${details.newStage}`;
        } else if (action === "lead.assigned") {
          title = `Lead Assigned to ${details.assignedMemberName || details.memberId || "Caller"}`;
        } else if (action === "lead.bulk_assigned") {
          title = `Assigned in Bulk to ${details.assignedMemberName || details.memberId || "Caller"}`;
        } else if (action === "lead.unassigned" || action === "lead.bulk_unassigned") {
          title = "Lead Unassigned";
        } else if (action === "dnc_suggestion.created") {
          title = `DNC Suggestion Flagged (${details.detectedKeyword || "Keyword"})`;
        } else if (action === "dnc_suggestion.approved") {
          title = "Added to DNC Blocklist";
        } else if (action === "dnc_suggestion.dismissed") {
          title = "DNC Suggestion Dismissed";
        }

        events.push({
          id: `audit-${log.id}`,
          type: "audit",
          timestamp: log.createdAt ? new Date(log.createdAt).toISOString() : new Date().toISOString(),
          title,
          actor: log.actor || "System",
          status: action,
          badge: log.entityType || "AUDIT",
          notes: details.note || details.notes || null,
          details,
        });
      }
    }
  } catch {
    // Non-blocking
  }

  // Sort descending by timestamp
  return events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}
