import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import {
  activities,
  companies,
  emailActivities,
  type EmailActivityStatus,
} from "../db/schema";
import { sendProspectEmail } from "../services/email";
import { createActivity } from "./activities";
import { audit } from "./audit";
import {
  computePresetFollowUpMs,
  formatFollowUpPkt,
  CALLER_TIMEZONE,
} from "../domain/call-time";
import { prependLogEntry } from "./caller";

export interface SendProspectEmailInput {
  companyId: string;
  contactId?: string | null;
  recipientEmail: string;
  recipientName?: string | null;
  templateKey?: string | null;
  subject: string;
  bodyText: string;
  actor: string;
  replyTo?: string | null;
}

export interface SendProspectEmailResult {
  ok: boolean;
  emailActivityId: string;
  resendMessageId?: string;
  followUpDate: string;
  followUpUtc: Date;
  updatedNotes: string;
  error?: string;
}

export interface EmailActivityRecord {
  id: string;
  companyId: string;
  contactId: string | null;
  recipientEmail: string;
  recipientName: string | null;
  status: EmailActivityStatus;
  templateKey: string | null;
  subject: string;
  bodyText: string;
  sentAt: Date | null;
  resendMessageId: string | null;
  openedAt: Date | null;
  repliedAt: Date | null;
  actor: string;
  createdAt: Date;
}

/**
 * Sends an email to a prospect, logs the activity, closes open EMAIL tasks,
 * schedules a +2 business day follow-up call, and updates notes & audit log.
 */
export async function sendAndLogProspectEmail(
  db: Db,
  input: SendProspectEmailInput
): Promise<SendProspectEmailResult> {
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

  const now = new Date();

  // 1. Send the email via Resend
  const dispatchResult = await sendProspectEmail({
    to: input.recipientEmail.trim(),
    recipientName: input.recipientName || undefined,
    subject: input.subject.trim(),
    bodyText: input.bodyText.trim(),
    replyTo: input.replyTo || undefined,
    actor: input.actor,
  });

  // 2. Insert into email_activities
  const [createdEmailActivity] = await db
    .insert(emailActivities)
    .values({
      companyId: input.companyId,
      contactId: input.contactId || null,
      recipientEmail: input.recipientEmail.trim().toLowerCase(),
      recipientName: input.recipientName || null,
      templateKey: input.templateKey || "custom",
      subject: input.subject.trim(),
      bodyText: input.bodyText.trim(),
      status: dispatchResult.ok ? "SENT" : "FAILED",
      sentAt: now,
      resendMessageId: dispatchResult.messageId || null,
      actor: input.actor,
    })
    .returning();

  // 3. Mark any open EMAIL task for this company as DONE
  await db
    .update(activities)
    .set({
      status: "DONE",
      completedAt: now,
      outcome: "EMAIL_SENT",
      updatedAt: now,
    })
    .where(
      and(
        eq(activities.companyId, input.companyId),
        inArray(activities.status, ["TODO", "IN_PROGRESS", "OVERDUE"]),
        eq(activities.type, "EMAIL")
      )
    );

  // 4. Calculate +2 business days follow-up (10:00 AM prospect-local time, skipping weekends)
  const followUpMs = computePresetFollowUpMs("TWO_DAYS", company.state, now.getTime());
  const followUpUtc = new Date(followUpMs);
  const followUpPkt = formatFollowUpPkt(followUpMs);

  // 5. Create the next scheduled CALL activity
  await createActivity(db, {
    companyId: input.companyId,
    type: "CALL",
    status: "TODO",
    dueAt: followUpUtc,
    assignedMemberId: company.assignedMemberId,
    assignedMemberName: company.assignedMemberName,
    notes: `Follow up on sent email to ${input.recipientEmail} ("${input.subject.trim()}")`,
  });

  // 6. Format note entry and update company
  const timeStr = now.toLocaleString("en-US", {
    timeZone: CALLER_TIMEZONE,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  const emailLogEntry = `[${timeStr} • ${input.actor} (Email Sent)]: Sent email to ${input.recipientEmail.trim()} ("${input.subject.trim()}")`;
  const finalNotes = prependLogEntry(company.notes, emailLogEntry, followUpPkt);

  await db
    .update(companies)
    .set({
      notes: finalNotes,
      nextFollowUpAt: followUpUtc,
      updatedAt: now,
    })
    .where(eq(companies.id, input.companyId));

  // 7. Record durable audit log
  await audit(db, {
    actor: input.actor,
    action: "PROSPECT_EMAIL_SENT",
    entityType: "company",
    entityId: input.companyId,
    companyId: input.companyId,
    details: {
      recipientEmail: input.recipientEmail.trim(),
      recipientName: input.recipientName || null,
      templateKey: input.templateKey || "custom",
      subject: input.subject.trim(),
      messageId: dispatchResult.messageId || null,
      followUpScheduled: followUpPkt,
      directSent: dispatchResult.directSent,
      error: dispatchResult.error || null,
    },
  });

  if (!createdEmailActivity) {
    throw new Error("Failed to insert email activity");
  }

  return {
    ok: dispatchResult.ok,
    emailActivityId: createdEmailActivity.id,
    resendMessageId: dispatchResult.messageId,
    followUpDate: followUpPkt,
    followUpUtc,
    updatedNotes: finalNotes,
    error: dispatchResult.error,
  };
}

/**
 * Returns all emails sent to a prospect company, ordered by most recent first.
 */
export async function getEmailActivitiesForCompany(
  db: Db,
  companyId: string
): Promise<EmailActivityRecord[]> {
  const rows = await db
    .select()
    .from(emailActivities)
    .where(eq(emailActivities.companyId, companyId))
    .orderBy(desc(emailActivities.sentAt), desc(emailActivities.createdAt))
    .limit(50);

  return rows as EmailActivityRecord[];
}
