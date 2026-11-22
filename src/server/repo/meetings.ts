import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import {
  activities,
  companies,
  meetings,
  type DealStage,
  type MeetingOutcome,
  type MeetingPlatform,
  type MeetingStatus,
  type QualificationStatus,
} from "../db/schema";

export type { MeetingOutcome, MeetingPlatform, MeetingStatus };
import { createActivity } from "./activities";
import { audit } from "./audit";
import { createNotification } from "./notifications";
import { prependLogEntry } from "./caller";
import { CALLER_TIMEZONE, formatFollowUpPkt } from "../domain/call-time";
import { sendAndLogProspectEmail } from "./email-activities";
import { renderEmailTemplate } from "../domain/email-templates";

export interface BookDiscoveryMeetingInput {
  companyId: string;
  meetingAt: Date | string;
  platform?: MeetingPlatform;
  meetingUrl?: string | null;
  attendeeName?: string | null;
  attendeeEmail?: string | null;
  bookedBy: string;
  prepNotes?: string | null;
  sendConfirmationEmail?: boolean;
}

export interface BookDiscoveryMeetingResult {
  ok: boolean;
  meetingId: string;
  meetingAt: Date;
  followUpDate: string;
  updatedNotes: string;
  confirmationEmailSent?: boolean;
}

export interface UpdateMeetingOutcomeInput {
  meetingId: string;
  status: MeetingStatus;
  outcome?: MeetingOutcome | null;
  outcomeNotes?: string | null;
  actor: string;
  newMeetingAt?: Date | string | null;
}

export interface MeetingRecord {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  companyId: string;
  status: MeetingStatus;
  meetingAt: Date;
  platform: MeetingPlatform;
  meetingUrl: string | null;
  attendeeName: string | null;
  attendeeEmail: string | null;
  bookedBy: string;
  prepNotes: string | null;
  outcomeNotes: string | null;
  outcome: MeetingOutcome | null;
}

export interface AdminMeetingView extends MeetingRecord {
  companyName: string;
  phoneDisplay: string | null;
  state: string | null;
  assignedMemberName: string | null;
}

/**
 * Books a discovery meeting atomically:
 * 1. Inserts into `meetings` table.
 * 2. Sets `companies.status = 'MEETING_BOOKED'` & `companies.next_follow_up_at = meetingAt`.
 * 3. Prepends structured meeting note to `companies.notes`.
 * 4. Completes open CALL/EMAIL tasks & schedules a MEETING_PREP task due at meetingAt.
 * 5. Sends an in-app notification to the Owner/Admin.
 * 6. Logs structured audit entry.
 * 7. Optionally sends a confirmation email to the attendee.
 */
export async function bookDiscoveryMeeting(
  db: Db,
  input: BookDiscoveryMeetingInput
): Promise<BookDiscoveryMeetingResult> {
  const [company] = await db
    .select({
      id: companies.id,
      name: companies.name,
      notes: companies.notes,
      state: companies.state,
      assignedMemberId: companies.assignedMemberId,
      assignedMemberName: companies.assignedMemberName,
    })
    .from(companies)
    .where(eq(companies.id, input.companyId))
    .limit(1);

  if (!company) {
    throw new Error(`Company not found: ${input.companyId}`);
  }

  const meetingDate = new Date(input.meetingAt);
  if (isNaN(meetingDate.getTime())) {
    throw new Error(`Invalid meeting date: ${input.meetingAt}`);
  }

  const platform: MeetingPlatform = input.platform || "ZOOM";
  const now = new Date();

  // 1. Insert into meetings table
  const [createdMeeting] = await db
    .insert(meetings)
    .values({
      companyId: input.companyId,
      meetingAt: meetingDate,
      platform,
      meetingUrl: input.meetingUrl?.trim() || null,
      attendeeName: input.attendeeName?.trim() || null,
      attendeeEmail: input.attendeeEmail?.trim().toLowerCase() || null,
      bookedBy: input.bookedBy.trim(),
      prepNotes: input.prepNotes?.trim() || null,
      status: "SCHEDULED",
    })
    .returning();

  if (!createdMeeting) {
    throw new Error("Failed to create meeting record");
  }

  // 2. Format note log & follow-up tag
  const formattedFollowUp = formatFollowUpPkt(meetingDate.getTime());
  const nowStr = now.toLocaleString("en-US", {
    timeZone: CALLER_TIMEZONE,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const meetingDateStr = meetingDate.toLocaleString("en-US", {
    timeZone: CALLER_TIMEZONE,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  const logEntry = `[${nowStr} • ${input.bookedBy} (Meeting Booked)]: Discovery meeting scheduled for ${meetingDateStr} via ${platform}${
    input.meetingUrl ? ` (${input.meetingUrl.trim()})` : ""
  }${input.attendeeName ? ` with ${input.attendeeName.trim()}` : ""}${
    input.prepNotes ? ` • Notes: ${input.prepNotes.trim()}` : ""
  }`;

  const updatedNotes = prependLogEntry(company.notes, logEntry, formattedFollowUp);

  // Update company record
  await db
    .update(companies)
    .set({
      status: "MEETING_BOOKED",
      nextFollowUpAt: meetingDate,
      notes: updatedNotes,
      updatedAt: now,
      // Phase 6: sync qualification + deal stage
      qualificationStatus: "QUALIFIED" as QualificationStatus,
      dealStage: "MEETING_BOOKED" as DealStage,
    })
    .where(eq(companies.id, input.companyId));

  // 3. Mark prior open CALL / EMAIL activities as DONE
  await db
    .update(activities)
    .set({
      status: "DONE",
      completedAt: now,
      outcome: "MEETING_BOOKED",
      updatedAt: now,
    })
    .where(
      and(
        eq(activities.companyId, input.companyId),
        inArray(activities.status, ["TODO", "IN_PROGRESS", "OVERDUE"]),
        inArray(activities.type, ["CALL", "EMAIL"])
      )
    );

  // Create MEETING_PREP activity
  await createActivity(db, {
    companyId: input.companyId,
    type: "MEETING_PREP",
    status: "TODO",
    dueAt: meetingDate,
    assignedMemberId: company.assignedMemberId,
    assignedMemberName: company.assignedMemberName,
    notes: `Discovery call with ${input.attendeeName || "Prospect"} via ${platform}${
      input.prepNotes ? ` — ${input.prepNotes.trim()}` : ""
    }`,
    referenceId: createdMeeting.id,
  });

  // 4. Create in-app notification for Owner/Admin
  await createNotification(db, {
    recipientMemberId: "OWNER",
    title: `Discovery Call Booked: ${company.name}`,
    message: `${input.bookedBy} booked a discovery meeting with ${
      input.attendeeName || "Prospect"
    } for ${meetingDateStr} (${platform}).`,
    category: "meeting_booked",
    link: "/admin/monitor",
    entityType: "meeting",
    entityId: createdMeeting.id,
  });

  // 5. Durable audit log
  await audit(db, {
    actor: input.bookedBy,
    action: "MEETING_BOOKED_STRUCTURED",
    entityType: "meeting",
    entityId: createdMeeting.id,
    companyId: input.companyId,
    details: {
      meetingAt: meetingDate.toISOString(),
      platform,
      meetingUrl: input.meetingUrl?.trim() || null,
      attendeeName: input.attendeeName?.trim() || null,
      attendeeEmail: input.attendeeEmail?.trim() || null,
      prepNotes: input.prepNotes?.trim() || null,
      followUpScheduled: formattedFollowUp,
    },
  });

  // 6. Optional calendar/confirmation email
  let confirmationEmailSent = false;
  if (input.sendConfirmationEmail && input.attendeeEmail?.trim()) {
    try {
      const rendered = renderEmailTemplate("meeting_confirmation", {
        ownerName: input.attendeeName || "",
        companyName: company.name,
        senderName: input.bookedBy,
        city: company.state || "",
      });

      await sendAndLogProspectEmail(db, {
        companyId: input.companyId,
        recipientEmail: input.attendeeEmail.trim(),
        recipientName: input.attendeeName || undefined,
        templateKey: "meeting_confirmation",
        subject: rendered.subject,
        bodyText: rendered.bodyText,
        actor: input.bookedBy,
      });
      confirmationEmailSent = true;
    } catch {
      // Do not fail the booking if confirmation email has network issues
    }
  }

  return {
    ok: true,
    meetingId: createdMeeting.id,
    meetingAt: meetingDate,
    followUpDate: formattedFollowUp,
    updatedNotes,
    confirmationEmailSent,
  };
}

/**
 * Updates meeting attendance outcome:
 * - ATTENDED: transitions lead to DISCOVERY/PROPOSAL/LOST and completes prep task.
 * - NO_SHOW: completes prep task, auto-schedules recovery call in +4 hours, and updates next_follow_up_at.
 * - RESCHEDULED: updates meeting time, syncs prep task and company next_follow_up_at.
 * - CANCELLED: marks prep task SKIPPED.
 */
export async function updateMeetingOutcome(
  db: Db,
  input: UpdateMeetingOutcomeInput
): Promise<{ ok: boolean; status: MeetingStatus; updatedFollowUp?: Date | null }> {
  const [meeting] = await db
    .select()
    .from(meetings)
    .where(eq(meetings.id, input.meetingId))
    .limit(1);

  if (!meeting) {
    throw new Error(`Meeting not found: ${input.meetingId}`);
  }

  const [company] = await db
    .select({
      id: companies.id,
      name: companies.name,
      notes: companies.notes,
      assignedMemberId: companies.assignedMemberId,
      assignedMemberName: companies.assignedMemberName,
      status: companies.status,
    })
    .from(companies)
    .where(eq(companies.id, meeting.companyId))
    .limit(1);

  if (!company) {
    throw new Error(`Company not found for meeting: ${meeting.companyId}`);
  }

  const now = new Date();
  const timeStr = now.toLocaleString("en-US", {
    timeZone: CALLER_TIMEZONE,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  if (input.status === "ATTENDED") {
    // 1. Update meeting
    await db
      .update(meetings)
      .set({
        status: "ATTENDED",
        outcome: input.outcome || null,
        outcomeNotes: input.outcomeNotes?.trim() || null,
        updatedAt: now,
      })
      .where(eq(meetings.id, input.meetingId));

    // 2. Complete MEETING_PREP task
    await db
      .update(activities)
      .set({
        status: "DONE",
        completedAt: now,
        outcome: input.outcome || "ATTENDED",
        updatedAt: now,
      })
      .where(
        and(
          eq(activities.companyId, meeting.companyId),
          eq(activities.type, "MEETING_PREP"),
          inArray(activities.status, ["TODO", "IN_PROGRESS", "OVERDUE"])
        )
      );

    // 3. Determine next company status
    let nextCompanyStatus = "DISCOVERY";
    if (input.outcome === "PROPOSAL_SENT") {
      nextCompanyStatus = "PROPOSAL";
    } else if (input.outcome === "LOST" || input.outcome === "NOT_QUALIFIED") {
      nextCompanyStatus = "LOST";
    }

    const logEntry = `[${timeStr} • ${input.actor} (Meeting Attended)]: Discovery meeting attended. Outcome: ${
      input.outcome || "Attended"
    }${input.outcomeNotes ? ` • Notes: ${input.outcomeNotes.trim()}` : ""}`;

    const updatedNotes = prependLogEntry(company.notes, logEntry, null);

    await db
      .update(companies)
      .set({
        status: nextCompanyStatus as never,
        notes: updatedNotes,
        updatedAt: now,
        // Phase 6: sync qualification + deal stage from meeting outcome
        qualificationStatus: (input.outcome === "LOST" || input.outcome === "NOT_QUALIFIED"
          ? "DISQUALIFIED"
          : "QUALIFIED") as QualificationStatus,
        dealStage: (input.outcome === "PROPOSAL_SENT"
          ? "PROPOSAL"
          : input.outcome === "LOST" || input.outcome === "NOT_QUALIFIED"
          ? "CLOSED_LOST"
          : "DISCOVERY") as DealStage,
      })
      .where(eq(companies.id, meeting.companyId));

    // 4. Audit
    await audit(db, {
      actor: input.actor,
      action: "MEETING_OUTCOME_UPDATED",
      entityType: "meeting",
      entityId: meeting.id,
      companyId: meeting.companyId,
      details: {
        status: "ATTENDED",
        outcome: input.outcome || null,
        outcomeNotes: input.outcomeNotes || null,
        nextCompanyStatus,
      },
    });

    return { ok: true, status: "ATTENDED" };
  }

  if (input.status === "NO_SHOW") {
    // 1. Update meeting
    await db
      .update(meetings)
      .set({
        status: "NO_SHOW",
        outcomeNotes: input.outcomeNotes?.trim() || null,
        updatedAt: now,
      })
      .where(eq(meetings.id, input.meetingId));

    // 2. Complete existing MEETING_PREP task with outcome NO_SHOW
    await db
      .update(activities)
      .set({
        status: "DONE",
        completedAt: now,
        outcome: "NO_SHOW",
        updatedAt: now,
      })
      .where(
        and(
          eq(activities.companyId, meeting.companyId),
          eq(activities.type, "MEETING_PREP"),
          inArray(activities.status, ["TODO", "IN_PROGRESS", "OVERDUE"])
        )
      );

    // 3. Auto-schedule high-priority recovery CALL activity in +4 hours
    const recoveryDueAt = new Date(Date.now() + 4 * 60 * 60 * 1000);
    const recoveryFollowUpPkt = formatFollowUpPkt(recoveryDueAt.getTime());

    await createActivity(db, {
      companyId: meeting.companyId,
      type: "CALL",
      status: "TODO",
      dueAt: recoveryDueAt,
      assignedMemberId: company.assignedMemberId,
      assignedMemberName: company.assignedMemberName,
      notes: "No-show recovery call — reschedule discovery meeting",
      referenceId: meeting.id,
    });

    const logEntry = `[${timeStr} • ${input.actor} (Meeting No-Show)]: Prospect was a no-show for discovery call. Scheduled recovery call in +4 hours.${
      input.outcomeNotes ? ` • Notes: ${input.outcomeNotes.trim()}` : ""
    }`;

    const updatedNotes = prependLogEntry(company.notes, logEntry, recoveryFollowUpPkt);

    // Update company next_follow_up_at so lead re-enters the active calling queue
    await db
      .update(companies)
      .set({
        nextFollowUpAt: recoveryDueAt,
        notes: updatedNotes,
        updatedAt: now,
      })
      .where(eq(companies.id, meeting.companyId));

    // 4. Audit
    await audit(db, {
      actor: input.actor,
      action: "MEETING_NO_SHOW_RECORDED",
      entityType: "meeting",
      entityId: meeting.id,
      companyId: meeting.companyId,
      details: {
        recoveryDueAt: recoveryDueAt.toISOString(),
        outcomeNotes: input.outcomeNotes || null,
      },
    });

    return { ok: true, status: "NO_SHOW", updatedFollowUp: recoveryDueAt };
  }

  if (input.status === "RESCHEDULED") {
    const newDate = input.newMeetingAt ? new Date(input.newMeetingAt) : null;
    if (!newDate || isNaN(newDate.getTime())) {
      throw new Error("Rescheduling requires a valid newMeetingAt date.");
    }

    const formattedNewDate = formatFollowUpPkt(newDate.getTime());
    const meetingDateStr = newDate.toLocaleString("en-US", {
      timeZone: CALLER_TIMEZONE,
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });

    // 1. Update meeting
    await db
      .update(meetings)
      .set({
        meetingAt: newDate,
        status: "RESCHEDULED",
        outcomeNotes: input.outcomeNotes?.trim() || null,
        updatedAt: now,
      })
      .where(eq(meetings.id, input.meetingId));

    // 2. Update existing MEETING_PREP task
    await db
      .update(activities)
      .set({
        dueAt: newDate,
        status: "TODO",
        updatedAt: now,
      })
      .where(
        and(
          eq(activities.companyId, meeting.companyId),
          eq(activities.type, "MEETING_PREP"),
          inArray(activities.status, ["TODO", "IN_PROGRESS", "OVERDUE"])
        )
      );

    const logEntry = `[${timeStr} • ${input.actor} (Meeting Rescheduled)]: Discovery meeting rescheduled to ${meetingDateStr}.${
      input.outcomeNotes ? ` • Notes: ${input.outcomeNotes.trim()}` : ""
    }`;

    const updatedNotes = prependLogEntry(company.notes, logEntry, formattedNewDate);

    await db
      .update(companies)
      .set({
        nextFollowUpAt: newDate,
        notes: updatedNotes,
        updatedAt: now,
      })
      .where(eq(companies.id, meeting.companyId));

    // 3. Audit
    await audit(db, {
      actor: input.actor,
      action: "MEETING_RESCHEDULED",
      entityType: "meeting",
      entityId: meeting.id,
      companyId: meeting.companyId,
      details: {
        newMeetingAt: newDate.toISOString(),
        outcomeNotes: input.outcomeNotes || null,
      },
    });

    return { ok: true, status: "RESCHEDULED", updatedFollowUp: newDate };
  }

  if (input.status === "CANCELLED") {
    // 1. Update meeting
    await db
      .update(meetings)
      .set({
        status: "CANCELLED",
        outcomeNotes: input.outcomeNotes?.trim() || null,
        updatedAt: now,
      })
      .where(eq(meetings.id, input.meetingId));

    // 2. Skip existing MEETING_PREP task
    await db
      .update(activities)
      .set({
        status: "SKIPPED",
        outcome: "MEETING_CANCELLED",
        updatedAt: now,
      })
      .where(
        and(
          eq(activities.companyId, meeting.companyId),
          eq(activities.type, "MEETING_PREP"),
          inArray(activities.status, ["TODO", "IN_PROGRESS", "OVERDUE"])
        )
      );

    const logEntry = `[${timeStr} • ${input.actor} (Meeting Cancelled)]: Discovery meeting cancelled.${
      input.outcomeNotes ? ` • Notes: ${input.outcomeNotes.trim()}` : ""
    }`;

    const updatedNotes = prependLogEntry(company.notes, logEntry, null);

    await db
      .update(companies)
      .set({
        notes: updatedNotes,
        updatedAt: now,
      })
      .where(eq(companies.id, meeting.companyId));

    // 3. Audit
    await audit(db, {
      actor: input.actor,
      action: "MEETING_CANCELLED",
      entityType: "meeting",
      entityId: meeting.id,
      companyId: meeting.companyId,
      details: {
        outcomeNotes: input.outcomeNotes || null,
      },
    });

    return { ok: true, status: "CANCELLED" };
  }

  return { ok: true, status: input.status };
}

/**
 * Returns all meetings booked for a given company, latest first.
 */
export async function getMeetingsForCompany(
  db: Db,
  companyId: string
): Promise<MeetingRecord[]> {
  const rows = await db
    .select()
    .from(meetings)
    .where(eq(meetings.companyId, companyId))
    .orderBy(desc(meetings.meetingAt));

  return rows as MeetingRecord[];
}

/**
 * Returns upcoming or all meetings joined with company info for /admin/monitor.
 */
export async function getMeetingsForAdmin(
  db: Db,
  options: { status?: MeetingStatus; limit?: number } = {}
): Promise<AdminMeetingView[]> {
  const conditions = [];
  if (options.status) {
    conditions.push(eq(meetings.status, options.status));
  }

  const rows = await db
    .select({
      id: meetings.id,
      createdAt: meetings.createdAt,
      updatedAt: meetings.updatedAt,
      companyId: meetings.companyId,
      status: meetings.status,
      meetingAt: meetings.meetingAt,
      platform: meetings.platform,
      meetingUrl: meetings.meetingUrl,
      attendeeName: meetings.attendeeName,
      attendeeEmail: meetings.attendeeEmail,
      bookedBy: meetings.bookedBy,
      prepNotes: meetings.prepNotes,
      outcomeNotes: meetings.outcomeNotes,
      outcome: meetings.outcome,
      companyName: companies.name,
      phoneDisplay: companies.phoneDisplay,
      state: companies.state,
      assignedMemberName: companies.assignedMemberName,
    })
    .from(meetings)
    .innerJoin(companies, eq(meetings.companyId, companies.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(meetings.meetingAt))
    .limit(options.limit || 50);

  return rows as AdminMeetingView[];
}
