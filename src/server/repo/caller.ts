import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { companies, contacts, leadScores, systemSettings } from "../db/schema";
import { type LifecycleStatus } from "../domain/lifecycle";
import { getContactsForCompanies, toContactInput } from "./contacts";
import { classifyEmail, classifyTitle, pickBestContact } from "../domain/contact";
import { cleanPhone, normalizeCompanyName, normalizeWebsite } from "../domain/normalize";
import { cleanPersonName } from "../enrichment/people";
import { evaluateGate, type LeadGate } from "../domain/gate";
import { type FactMap, factValue } from "../domain/facts";
import { type CustomCrmColumn } from "../domain/niche-fields";
import { setFact } from "./facts";
import { audit } from "./audit";
import { createNotification } from "./notifications";

export function extractLatestFollowUp(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const matches = [...notes.matchAll(/\[Next Follow-up Scheduled:\s*([^\]]+)\]/gi)];
  if (matches.length === 0) return null;
  return matches[matches.length - 1]?.[1]?.trim() || null;
}

export function stripFollowUpTags(notes: string | null | undefined): string {
  if (!notes) return "";
  return notes
    .replace(/\[Next Follow-up Scheduled:\s*[^\]]+\]\s*/gi, "")
    .trim();
}

export interface CallerLeadView {
  companyId: string;
  name: string;
  website: string | null;
  phone: string | null;
  address?: string | null;
  city: string | null;
  state: string | null;
  status: LifecycleStatus;
  icpScore: number;
  confidence: number;
  grade: string;
  bestContact: {
    name: string | null;
    title: string | null;
    phone: string | null;
    email: string | null;
    grade: string;
  };
  replacement: string;
  installation: string;
  financing: string;
  software: string;
  facts: Record<string, string>;
  financingObserved?: boolean;
  installSignalObserved?: boolean;
  onlineBookingObserved?: boolean;
  researchSummary: string | null;
  notes: string | null;
  nextFollowUp: string | null;
  assignedMemberId: string | null;
  assignedMemberName: string | null;
  marketId?: string;
  marketName?: string;
}

export interface CallFeedbackInput {
  companyId: string;
  actor: string;
  callOutcome: "CONNECTED" | "MEETING_BOOKED" | "GATEKEEPER_BLOCKED" | "WRONG_NUMBER" | "NO_ANSWER" | "CALL_COMPLETED";
  painIdentified?: string | null;
  softwareConfirmed?: string | null;
  fleetSizeConfirmed?: number | null;
  callerNotes: string;
}

export async function getCallerQueue(
  db: Db,
  marketId?: string,
  _gate?: Partial<LeadGate> | null,
  options?: {
    includeCrossMarketForOwner?: boolean;
    marketNames?: Record<string, string>;
  }
): Promise<CallerLeadView[]> {
  const callerStatuses: LifecycleStatus[] = [
    "APPROVED",
    "SYNCED",
    "CALLING",
    "CONNECTED",
    "PAIN_FOUND",
    "MEETING_BOOKED",
    "QUALIFIED",
    "NURTURE",
  ];

  const statusOrAssignedCondition = sql`(${inArray(companies.status, callerStatuses)} OR (${companies.assignedMemberId} IS NOT NULL AND ${companies.assignedMemberId} != '' AND ${companies.status} != 'REJECTED'))`;

  const whereClause =
    marketId && !options?.includeCrossMarketForOwner
      ? and(statusOrAssignedCondition, eq(companies.marketId, marketId))
      : statusOrAssignedCondition;

  const rows = await db
    .select()
    .from(companies)
    .where(whereClause);

  if (rows.length === 0) return [];

  const companyIds = rows.map((r) => r.id);
  const [contactsMap, scoresRows] = await Promise.all([
    getContactsForCompanies(db, companyIds),
    db
      .select()
      .from(leadScores)
      .where(inArray(leadScores.companyId, companyIds)),
  ]);
  const scoreMap = new Map(scoresRows.map((s) => [s.companyId, s]));

  const queue: CallerLeadView[] = [];

  for (const c of rows) {
    const cs = (contactsMap.get(c.id) ?? []).map(toContactInput);
    const best = pickBestContact(cs, c.phoneDisplay);

    const score = scoreMap.get(c.id);
    const facts = (c.facts as FactMap) || {};
    const flatFacts: Record<string, string> = {};
    for (const [k, v] of Object.entries(facts)) {
      if (v && typeof v === "object" && "value" in v && typeof (v as any).value === "string") {
        flatFacts[k] = (v as any).value;
      } else if (typeof v === "string") {
        flatFacts[k] = v;
      }
    }

    const effectiveStatus: LifecycleStatus = callerStatuses.includes(c.status as LifecycleStatus)
      ? (c.status as LifecycleStatus)
      : "APPROVED";

    queue.push({
      companyId: c.id,
      name: c.name,
      website: c.website,
      phone: c.phoneDisplay,
      address: c.address ?? null,
      city: c.city,
      state: c.state,
      status: effectiveStatus,
      icpScore: score?.icpScore || 0,
      confidence: score?.researchConfidence || 0,
      grade: score?.grade || best.grade,
      bestContact: {
        name: best.name,
        title: best.title,
        phone: best.phone,
        email: best.email,
        grade: best.grade,
      },
      replacement: factValue(facts, "replacement"),
      installation: factValue(facts, "installation"),
      financing: factValue(facts, "financing"),
      software: factValue(facts, "software"),
      facts: flatFacts,
      financingObserved: factValue(facts, "financing") === "YES",
      installSignalObserved:
        factValue(facts, "installation") === "YES" || factValue(facts, "replacement") === "YES",
      onlineBookingObserved: flatFacts["onlineBooking"] === "YES",
      researchSummary: c.researchSummary,
      notes: c.notes,
      nextFollowUp: extractLatestFollowUp(c.notes),
      assignedMemberId: c.assignedMemberId ?? null,
      assignedMemberName: c.assignedMemberName ?? null,
      marketId: c.marketId,
      marketName: options?.marketNames?.[c.marketId] || undefined,
    });
  }

  // Sort queue: active market leads first (if specified), then by highest ICP Score
  queue.sort((a, b) => {
    if (marketId) {
      const aMatch = a.marketId === marketId ? 1 : 0;
      const bMatch = b.marketId === marketId ? 1 : 0;
      if (aMatch !== bMatch) return bMatch - aMatch;
    }
    return b.icpScore - a.icpScore;
  });
  return queue;
}

export async function recordCallFeedback(
  db: Db,
  input: CallFeedbackInput
): Promise<{ ok: true; nextStatus: LifecycleStatus }> {
  const [company] = await db
    .select()
    .from(companies)
    .where(eq(companies.id, input.companyId))
    .limit(1);

  if (!company) throw new Error(`Company ${input.companyId} not found`);

  let nextStatus: LifecycleStatus = "CALLING";

  if (input.callOutcome === "MEETING_BOOKED") {
    nextStatus = "MEETING_BOOKED";
  } else if (input.painIdentified && input.painIdentified.trim().length > 0) {
    nextStatus = "PAIN_FOUND";
  } else if (input.callOutcome === "CONNECTED") {
    nextStatus = "CONNECTED";
  } else if (input.callOutcome === "WRONG_NUMBER") {
    nextStatus = "NURTURE";
  }

  // 1. If human confirmed software, record with HUMAN_CONFIRMED provenance
  if (input.softwareConfirmed && input.softwareConfirmed !== "UNKNOWN") {
    await setFact(db, {
      companyId: input.companyId,
      field: "software",
      value: input.softwareConfirmed.trim().toLowerCase(),
      confidence: 1.0,
      provenance: "HUMAN_CONFIRMED",
      sourceType: "manual_entry",
      evidenceText: `Confirmed by ${input.actor} during phone discovery call: "${input.softwareConfirmed}"`,
      actor: input.actor,
    });
  }

  // 2. If human confirmed fleet size / employee count, record fact
  if (input.fleetSizeConfirmed && input.fleetSizeConfirmed > 0) {
    await setFact(db, {
      companyId: input.companyId,
      field: "employees",
      value: String(input.fleetSizeConfirmed),
      confidence: 1.0,
      provenance: "HUMAN_CONFIRMED",
      sourceType: "manual_entry",
      evidenceText: `Confirmed by ${input.actor} during phone discovery call: ${input.fleetSizeConfirmed} active technicians/trucks`,
      actor: input.actor,
    });
  }

  // 3. Update company lifecycle status and notes (strip old follow-up tags if a new one is included)
  const hasNewFollowUp = /\[Next Follow-up Scheduled:\s*[^\]]+\]/i.test(input.callerNotes);
  const baseExistingNotes = hasNewFollowUp ? stripFollowUpTags(company.notes) : (company.notes || "");
  const updatedNotes = baseExistingNotes
    ? `${baseExistingNotes}\n[Call ${new Date().toISOString().slice(0, 10)}] ${input.callerNotes}`
    : `[Call ${new Date().toISOString().slice(0, 10)}] ${input.callerNotes}`;

  await db
    .update(companies)
    .set({
      status: nextStatus,
      notes: updatedNotes,
      updatedAt: new Date(),
    })
    .where(eq(companies.id, input.companyId));

  // 4. Append audit log
  await audit(db, {
    actor: input.actor,
    action: "caller.call_logged",
    entityType: "company",
    entityId: input.companyId,
    companyId: input.companyId,
    details: {
      callOutcome: input.callOutcome,
      nextStatus,
      painIdentified: input.painIdentified,
      softwareConfirmed: input.softwareConfirmed,
      fleetSizeConfirmed: input.fleetSizeConfirmed,
      notes: input.callerNotes,
    },
  });

  return { ok: true, nextStatus };
}

export interface UpdateLeadCrmInput {
  companyId: string;
  name?: string;
  website?: string | null;
  phone?: string | null;
  city?: string | null;
  state?: string | null;
  address?: string | null;
  status?: LifecycleStatus;
  contactName?: string | null;
  contactTitle?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  nextFollowUp?: string | null;
  notes?: string | null;
  assignedMemberId?: string | null;
  assignedMemberName?: string | null;
}

export async function updateLeadCrmDetails(
  db: Db,
  input: UpdateLeadCrmInput,
  actor: string
): Promise<void> {
  const [company] = await db
    .select()
    .from(companies)
    .where(eq(companies.id, input.companyId))
    .limit(1);

  if (!company) throw new Error("Lead not found");

  const companyUpdates: Record<string, any> = {
    updatedAt: new Date(),
  };

  if (input.name !== undefined && input.name.trim()) {
    companyUpdates.name = input.name.trim();
    companyUpdates.nameKey = normalizeCompanyName(input.name.trim());
  }

  if (input.website !== undefined) {
    if (input.website && input.website.trim()) {
      const w = normalizeWebsite(input.website.trim());
      companyUpdates.website = w.ok ? w.value.url : input.website.trim();
      companyUpdates.domain = w.ok ? w.value.domain : null;
    } else {
      companyUpdates.website = null;
      companyUpdates.domain = null;
    }
  }

  if (input.phone !== undefined) {
    if (input.phone && input.phone.trim()) {
      const p = cleanPhone(input.phone.trim());
      companyUpdates.phoneDisplay = p ? p.display : input.phone.trim();
      companyUpdates.phoneE164 = p ? p.e164 : null;
    } else {
      companyUpdates.phoneDisplay = null;
      companyUpdates.phoneE164 = null;
    }
  }

  if (input.city !== undefined) {
    companyUpdates.city = input.city?.trim() || null;
    companyUpdates.cityKey = input.city?.trim().toLowerCase() || null;
  }

  if (input.state !== undefined) {
    companyUpdates.state = input.state?.trim().toUpperCase() || null;
  }

  if (input.address !== undefined) {
    companyUpdates.address = input.address?.trim() || null;
  }

  if (input.status !== undefined) {
    companyUpdates.status = input.status;
  }

  if (input.assignedMemberId !== undefined) {
    companyUpdates.assignedMemberId = input.assignedMemberId || null;
    companyUpdates.assignedMemberName = input.assignedMemberName || null;
  }

  // Handle notes + nextFollowUp cleanly
  if (input.notes !== undefined || input.nextFollowUp !== undefined) {
    const rawNotes = input.notes !== undefined ? (input.notes || "") : (company.notes || "");
    const cleanedNotes = stripFollowUpTags(rawNotes);
    const desiredFollowUp =
      input.nextFollowUp !== undefined
        ? input.nextFollowUp?.trim() || null
        : extractLatestFollowUp(company.notes);

    companyUpdates.notes = desiredFollowUp
      ? cleanedNotes
        ? `[Next Follow-up Scheduled: ${desiredFollowUp}]\n${cleanedNotes}`
        : `[Next Follow-up Scheduled: ${desiredFollowUp}]`
      : cleanedNotes || null;
  }

  await db
    .update(companies)
    .set(companyUpdates)
    .where(eq(companies.id, input.companyId));

  // Update or create primary contact if contact fields were provided
  if (
    input.contactName !== undefined ||
    input.contactTitle !== undefined ||
    input.contactEmail !== undefined ||
    input.contactPhone !== undefined
  ) {
    const existingContacts = await db
      .select()
      .from(contacts)
      .where(and(eq(contacts.companyId, input.companyId), eq(contacts.status, "ACTIVE")));

    const cName = input.contactName?.trim() || null;
    const cTitle = input.contactTitle?.trim() || null;
    const cEmail = input.contactEmail?.trim().toLowerCase() || null;
    const cPhoneRaw = input.contactPhone?.trim() || input.phone?.trim() || null;
    const parsedPhone = cPhoneRaw ? cleanPhone(cPhoneRaw) : null;
    const cPhoneDisplay = parsedPhone ? parsedPhone.display : cPhoneRaw;
    const cPhoneE164 = parsedPhone ? parsedPhone.e164 : null;

    if (existingContacts.length > 0) {
      const primary = existingContacts[0]!;
      await db
        .update(contacts)
        .set({
          name: cName ?? primary.name,
          title: cTitle ?? primary.title,
          roleClass: cTitle ? classifyTitle(cTitle) : primary.roleClass,
          email: cEmail !== undefined ? cEmail : primary.email,
          emailType: cEmail ? classifyEmail(cEmail, company.domain) : primary.emailType,
          phoneDisplay: cPhoneDisplay ?? primary.phoneDisplay,
          phoneE164: cPhoneE164 ?? primary.phoneE164,
          verified: true,
          provenance: "HUMAN_CONFIRMED",
          updatedAt: new Date(),
        })
        .where(eq(contacts.id, primary.id));
    } else if (cName || cEmail || cPhoneDisplay) {
      await db.insert(contacts).values({
        companyId: input.companyId,
        name: cName,
        title: cTitle || "Decision Maker",
        roleClass: classifyTitle(cTitle || "Owner"),
        email: cEmail,
        emailType: classifyEmail(cEmail, company.domain),
        phoneDisplay: cPhoneDisplay,
        phoneE164: cPhoneE164,
        phoneType: "DIRECT",
        verified: true,
        confidence: 1.0,
        provenance: "HUMAN_CONFIRMED",
        sourceType: "manual_entry",
      });
    }
  }

  await audit(db, {
    actor,
    action: "crm.lead_updated",
    entityType: "company",
    entityId: input.companyId,
    companyId: input.companyId,
    details: {
      updatedFields: Object.keys(companyUpdates),
    },
  });
}

export async function updateLeadStatusQuick(
  db: Db,
  companyId: string,
  status: LifecycleStatus,
  actor: string
): Promise<void> {
  await db
    .update(companies)
    .set({
      status,
      updatedAt: new Date(),
    })
    .where(eq(companies.id, companyId));

  await audit(db, {
    actor,
    action: "crm.status_changed",
    entityType: "company",
    entityId: companyId,
    companyId,
    details: { status },
  });
}

export async function updateLeadFollowUp(
  db: Db,
  companyId: string,
  followUpDate: string | null,
  note: string | null | undefined,
  actor: string
): Promise<{ updatedNotes: string | null; nextFollowUp: string | null }> {
  const [company] = await db
    .select()
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);

  if (!company) throw new Error("Lead not found");

  const cleanedExisting = stripFollowUpTags(company.notes);
  const appendedBody = note?.trim()
    ? cleanedExisting
      ? `${cleanedExisting}\n[Follow-Up Note ${new Date().toISOString().slice(0, 10)}] ${note.trim()}`
      : `[Follow-Up Note ${new Date().toISOString().slice(0, 10)}] ${note.trim()}`
    : cleanedExisting;

  const trimmedDate = followUpDate?.trim() || null;
  const finalNotes = trimmedDate
    ? appendedBody
      ? `[Next Follow-up Scheduled: ${trimmedDate}]\n${appendedBody}`
      : `[Next Follow-up Scheduled: ${trimmedDate}]`
    : appendedBody || null;

  await db
    .update(companies)
    .set({
      notes: finalNotes,
      updatedAt: new Date(),
    })
    .where(eq(companies.id, companyId));

  await audit(db, {
    actor,
    action: trimmedDate ? "crm.followup_scheduled" : "crm.followup_cleared",
    entityType: "company",
    entityId: companyId,
    companyId,
    details: { followUpDate: trimmedDate, note: note || null },
  });

  return { updatedNotes: finalNotes, nextFollowUp: trimmedDate };
}

export interface CreateManualCrmLeadInput {
  marketId: string;
  name: string;
  phone: string;
  website?: string | null;
  city?: string | null;
  state?: string | null;
  address?: string | null;
  contactName?: string | null;
  contactTitle?: string | null;
  contactEmail?: string | null;
  nextFollowUp?: string | null;
  notes?: string | null;
  assignedMemberId?: string | null;
  assignedMemberName?: string | null;
}

export async function createManualCrmLead(
  db: Db,
  input: CreateManualCrmLeadInput,
  actor: string
): Promise<CallerLeadView> {
  const cleanName = input.name.trim();
  if (!cleanName) throw new Error("Company name is required.");

  const p = cleanPhone(input.phone.trim());
  const phoneDisplay = p ? p.display : input.phone.trim();
  const phoneE164 = p ? p.e164 : null;

  const w = input.website?.trim() ? normalizeWebsite(input.website.trim()) : null;
  const website = w && w.ok ? w.value.url : input.website?.trim() || null;
  const domain = w && w.ok ? w.value.domain : null;

  const city = input.city?.trim() || null;
  const state = input.state?.trim().toUpperCase() || "TX";
  const address = input.address?.trim() || null;

  const followUp = input.nextFollowUp?.trim() || null;
  const rawNote = input.notes?.trim() || null;
  const combinedNotes = followUp
    ? rawNote
      ? `[Next Follow-up Scheduled: ${followUp}]\n${rawNote}`
      : `[Next Follow-up Scheduled: ${followUp}]`
    : rawNote;

  const [created] = await db
    .insert(companies)
    .values({
      marketId: input.marketId,
      name: cleanName,
      nameKey: normalizeCompanyName(cleanName),
      website,
      domain,
      phoneDisplay,
      phoneE164,
      address,
      city,
      cityKey: city?.toLowerCase() || null,
      state,
      status: "APPROVED",
      discoveredVia: "manual_crm_entry",
      approvedAt: new Date(),
      approvedBy: actor,
      notes: combinedNotes,
      assignedMemberId: input.assignedMemberId || null,
      assignedMemberName: input.assignedMemberName || null,
    })
    .returning();

  const companyId = created!.id;

  const cName = input.contactName?.trim() || null;
  const cTitle = input.contactTitle?.trim() || "Owner / Decision Maker";
  const cEmail = input.contactEmail?.trim().toLowerCase() || null;

  if (cName || cEmail || phoneDisplay) {
    const validContactName = cName ? (cleanPersonName(cName) || cName) : null;
    await db.insert(contacts).values({
      companyId,
      name: validContactName,
      title: cTitle,
      roleClass: classifyTitle(cTitle),
      email: cEmail,
      emailType: classifyEmail(cEmail, domain),
      phoneDisplay,
      phoneE164,
      phoneType: "DIRECT",
      verified: true,
      confidence: 1.0,
      provenance: "HUMAN_CONFIRMED",
      sourceType: "manual_entry",
    });
  }

  await db.insert(leadScores).values({
    companyId,
    icpScore: 88,
    researchConfidence: 95,
    grade: "A",
    breakdown: { manualEntry: true },
  });

  await audit(db, {
    actor,
    action: "crm.lead_created",
    entityType: "company",
    entityId: companyId,
    companyId,
    details: { name: cleanName, phone: phoneDisplay },
  });

  return {
    companyId,
    name: cleanName,
    website,
    phone: phoneDisplay,
    address,
    city,
    state,
    status: "APPROVED",
    icpScore: 88,
    confidence: 95,
    grade: "A",
    bestContact: {
      name: cName || "Owner / Managing Director",
      title: cTitle,
      phone: phoneDisplay,
      email: cEmail,
      grade: "A",
    },
    replacement: "UNKNOWN",
    installation: "UNKNOWN",
    financing: "UNKNOWN",
    software: "UNKNOWN",
    facts: {},
    financingObserved: false,
    installSignalObserved: false,
    onlineBookingObserved: false,
    researchSummary: "Added directly to Leads CRM.",
    notes: combinedNotes,
    nextFollowUp: followUp,
    assignedMemberId: input.assignedMemberId || null,
    assignedMemberName: input.assignedMemberName || null,
  };
}

export async function deleteCrmLead(
  db: Db,
  companyId: string,
  actor: string
): Promise<void> {
  await db
    .update(companies)
    .set({
      status: "REJECTED",
      updatedAt: new Date(),
    })
    .where(eq(companies.id, companyId));

  await audit(db, {
    actor,
    action: "crm.lead_removed",
    entityType: "company",
    entityId: companyId,
    companyId,
    details: { archivedAs: "REJECTED" },
  });
}

export async function assignLeadToMember(
  db: Db,
  companyId: string,
  memberId: string | null,
  memberName: string | null,
  actor: string
): Promise<void> {
  const [company] = await db
    .select({
      id: companies.id,
      name: companies.name,
      status: companies.status,
      assignedMemberId: companies.assignedMemberId,
    })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);

  const prevMemberId = company?.assignedMemberId;
  const preApprovalStatuses = [
    "NEW",
    "ENRICHED",
    "IN_REVIEW",
    "DISCOVERED",
    "RESEARCHING",
    "RESEARCHED",
    "NEEDS_REVIEW",
    "DISQUALIFIED",
  ];
  const shouldPromoteToApproved =
    Boolean(memberId) && company && preApprovalStatuses.includes(company.status);

  await db
    .update(companies)
    .set({
      assignedMemberId: memberId || null,
      assignedMemberName: memberName || null,
      ...(shouldPromoteToApproved
        ? {
            status: "APPROVED",
            approvedAt: new Date(),
            approvedBy: actor,
          }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(companies.id, companyId));

  await audit(db, {
    actor,
    action: memberId ? "lead.assigned" : "lead.unassigned",
    entityType: "company",
    entityId: companyId,
    details: { assignedMemberId: memberId || null, assignedMemberName: memberName || null },
  });

  try {
    if (memberId) {
      await createNotification(db, {
        recipientMemberId: memberId,
        title: "Lead Assigned to Your Queue",
        message: `"${company?.name || "A lead"}" was assigned to you by ${actor}. Ready to dial.`,
        category: "lead_assigned",
        link: "/caller",
        entityType: "company",
        entityId: companyId,
      });
    } else if (prevMemberId) {
      await createNotification(db, {
        recipientMemberId: prevMemberId,
        title: "Lead Unassigned",
        message: `"${company?.name || "A lead"}" was unassigned from your queue by ${actor}.`,
        category: "lead_unassigned",
        link: "/caller",
        entityType: "company",
        entityId: companyId,
      });
    }
  } catch {
    // Non-blocking notification dispatch
  }
}

export async function autoDistributeLeads(
  db: Db,
  marketId: string,
  members: Array<{ id: string; name: string }>,
  actor: string
): Promise<{ distributedCount: number }> {
  if (members.length === 0) return { distributedCount: 0 };

  const unassigned = await db
    .select({ id: companies.id })
    .from(companies)
    .where(
      and(
        eq(companies.marketId, marketId),
        inArray(companies.status, ["APPROVED", "CALLING", "SYNCED"]),
        sql`(${companies.assignedMemberId} IS NULL OR ${companies.assignedMemberId} = '')`
      )
    );

  if (unassigned.length === 0) return { distributedCount: 0 };

  const distributionCounts: Record<string, { count: number; name: string }> = {};
  for (const m of members) {
    distributionCounts[m.id] = { count: 0, name: m.name };
  }

  let idx = 0;
  for (const row of unassigned) {
    const targetMember = members[idx % members.length]!;
    await db
      .update(companies)
      .set({
        assignedMemberId: targetMember.id,
        assignedMemberName: targetMember.name,
        updatedAt: new Date(),
      })
      .where(eq(companies.id, row.id));
    if (distributionCounts[targetMember.id]) {
      distributionCounts[targetMember.id]!.count++;
    }
    idx++;
  }

  await audit(db, {
    actor,
    action: "lead.auto_distributed",
    entityType: "market",
    entityId: marketId,
    details: { distributedCount: unassigned.length, membersCount: members.length },
  });

  try {
    for (const [mId, meta] of Object.entries(distributionCounts)) {
      if (meta.count > 0) {
        await createNotification(db, {
          recipientMemberId: mId,
          title: "New Leads Auto-Assigned",
          message: `${meta.count} leads were distributed to your queue by ${actor}. Ready to dial.`,
          category: "lead_assigned",
          link: "/caller",
          entityType: "market",
          entityId: marketId,
        });
      }
    }
  } catch {
    // Non-blocking
  }

  return { distributedCount: unassigned.length };
}

export async function updateLeadSmartField(
  db: Db,
  companyId: string,
  fieldKey: string,
  value: string,
  actor: string
): Promise<void> {
  const [company] = await db
    .select({ facts: companies.facts })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);

  if (!company) throw new Error("Lead not found");

  const currentFacts = ((company.facts as Record<string, any>) || {});
  const updatedFacts = {
    ...currentFacts,
    [fieldKey]: {
      value: value.trim(),
      confidence: 1.0,
      provenance: "HUMAN_CONFIRMED",
      sourceType: "manual_entry",
      updatedAt: new Date().toISOString(),
    },
  };

  await db
    .update(companies)
    .set({
      facts: updatedFacts as any,
      updatedAt: new Date(),
    })
    .where(eq(companies.id, companyId));

  await audit(db, {
    actor,
    action: "crm.smart_field_updated",
    entityType: "company",
    entityId: companyId,
    companyId,
    details: { fieldKey, value: value.trim() },
  });
}

export async function getCustomCrmColumns(
  db: Db,
  marketId: string
): Promise<CustomCrmColumn[]> {
  const key = `crm_custom_columns_${marketId}`;
  const [row] = await db
    .select()
    .from(systemSettings)
    .where(eq(systemSettings.key, key))
    .limit(1);

  if (!row || !Array.isArray(row.value)) return [];
  return row.value as CustomCrmColumn[];
}

export async function addCustomCrmColumn(
  db: Db,
  marketId: string,
  label: string,
  options: string[],
  actor: string
): Promise<CustomCrmColumn[]> {
  const cleanLabel = label.trim();
  if (!cleanLabel) throw new Error("Column name is required.");

  const existing = await getCustomCrmColumns(db, marketId);
  const slugKey =
    "custom_" +
    cleanLabel
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") +
    "_" +
    Date.now().toString(36).slice(-4);

  const nextCol: CustomCrmColumn = {
    key: slugKey,
    label: cleanLabel,
    options: options.map((o) => o.trim()).filter(Boolean),
  };

  const updated = [...existing, nextCol];
  const settingKey = `crm_custom_columns_${marketId}`;

  await db
    .insert(systemSettings)
    .values({ key: settingKey, value: updated as never })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: { value: updated as never, updatedAt: new Date() },
    });

  await audit(db, {
    actor,
    action: "crm.custom_column_added",
    entityType: "market",
    entityId: marketId,
    details: nextCol as unknown as Record<string, unknown>,
  });

  return updated;
}

export async function deleteCustomCrmColumn(
  db: Db,
  marketId: string,
  columnKey: string,
  actor: string
): Promise<CustomCrmColumn[]> {
  const existing = await getCustomCrmColumns(db, marketId);
  const updated = existing.filter((c) => c.key !== columnKey);
  const settingKey = `crm_custom_columns_${marketId}`;

  await db
    .insert(systemSettings)
    .values({ key: settingKey, value: updated as never })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: { value: updated as never, updatedAt: new Date() },
    });

  await audit(db, {
    actor,
    action: "crm.custom_column_deleted",
    entityType: "market",
    entityId: marketId,
    details: { columnKey },
  });

  return updated;
}

export async function assignBulkLeadsToCaller(
  db: Db,
  params: {
    marketId: string;
    memberId: string | null;
    memberName: string | null;
    count?: number;
    onlyUnassigned?: boolean;
    actor: string;
  }
): Promise<{ assignedCount: number }> {
  const callerStatuses: LifecycleStatus[] = [
    "APPROVED",
    "SYNCED",
    "CALLING",
    "CONNECTED",
    "PAIN_FOUND",
    "MEETING_BOOKED",
    "QUALIFIED",
    "NURTURE",
  ];

  const conditions = [
    eq(companies.marketId, params.marketId),
    inArray(companies.status, callerStatuses),
  ];

  if (params.onlyUnassigned) {
    conditions.push(
      sql`(${companies.assignedMemberId} IS NULL OR ${companies.assignedMemberId} = '')`
    );
  }

  const rows = await db
    .select({ id: companies.id })
    .from(companies)
    .where(and(...conditions))
    .orderBy(desc(companies.updatedAt))
    .limit(params.count && params.count > 0 ? params.count : 200);

  if (rows.length === 0) return { assignedCount: 0 };

  const ids = rows.map((r) => r.id);
  await db
    .update(companies)
    .set({
      assignedMemberId: params.memberId || null,
      assignedMemberName: params.memberName || null,
      updatedAt: new Date(),
    })
    .where(inArray(companies.id, ids));

  await audit(db, {
    actor: params.actor,
    action: params.memberId ? "lead.bulk_assigned_to_caller" : "lead.bulk_unassigned",
    entityType: "market",
    entityId: params.marketId,
    details: {
      assignedCount: ids.length,
      memberId: params.memberId || null,
      memberName: params.memberName || null,
    },
  });

  try {
    if (params.memberId) {
      await createNotification(db, {
        recipientMemberId: params.memberId,
        title: "Batch Leads Assigned",
        message: `${ids.length} leads were assigned to your calling queue by ${params.actor}. Ready to dial.`,
        category: "lead_assigned",
        link: "/caller",
        entityType: "market",
        entityId: params.marketId,
      });
    }
  } catch {
    // Non-blocking
  }

  return { assignedCount: ids.length };
}

export async function unassignCallerLeads(
  db: Db,
  params: { marketId: string; memberId: string; actor: string }
): Promise<{ unassignedCount: number }> {
  const rows = await db
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .where(eq(companies.assignedMemberId, params.memberId));

  if (rows.length === 0) return { unassignedCount: 0 };

  const ids = rows.map((r) => r.id);
  await db
    .update(companies)
    .set({
      assignedMemberId: null,
      assignedMemberName: null,
      updatedAt: new Date(),
    })
    .where(inArray(companies.id, ids));

  await audit(db, {
    actor: params.actor,
    action: "lead.bulk_unassigned",
    entityType: "market",
    entityId: params.marketId,
    details: {
      unassignedCount: ids.length,
      memberId: params.memberId,
    },
  });

  try {
    await createNotification(db, {
      recipientMemberId: params.memberId,
      title: "Queue Unassigned",
      message: `${ids.length} leads were unassigned from your queue by ${params.actor}.`,
      category: "lead_unassigned",
      link: "/caller",
      entityType: "market",
      entityId: params.marketId,
    });
  } catch {
    // Non-blocking
  }

  return { unassignedCount: ids.length };
}
