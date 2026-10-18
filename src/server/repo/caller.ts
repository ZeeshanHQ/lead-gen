import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { companies, leadScores } from "../db/schema";
import { type LifecycleStatus } from "../domain/lifecycle";
import { getContactsForCompanies, toContactInput } from "./contacts";
import { pickBestContact } from "../domain/contact";
import { type FactMap, factValue } from "../domain/facts";
import { setFact } from "./facts";
import { audit } from "./audit";

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
  researchSummary: string | null;
  notes: string | null;
  nextFollowUp: string | null;
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

export async function getCallerQueue(db: Db, marketId?: string): Promise<CallerLeadView[]> {
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

  const whereClause = marketId
    ? and(inArray(companies.status, callerStatuses), eq(companies.marketId, marketId))
    : inArray(companies.status, callerStatuses);

  const rows = await db
    .select()
    .from(companies)
    .where(whereClause);

  if (rows.length === 0) return [];

  const companyIds = rows.map((r) => r.id);
  const contactsMap = await getContactsForCompanies(db, companyIds);

  const scoresRows = await db
    .select()
    .from(leadScores)
    .where(inArray(leadScores.companyId, companyIds));
  const scoreMap = new Map(scoresRows.map((s) => [s.companyId, s]));

  const queue: CallerLeadView[] = [];

  for (const c of rows) {
    const cs = (contactsMap.get(c.id) ?? []).map(toContactInput);
    const best = pickBestContact(cs, c.phoneDisplay);
    const score = scoreMap.get(c.id);
    const facts = (c.facts as FactMap) || {};

    queue.push({
      companyId: c.id,
      name: c.name,
      website: c.website,
      phone: c.phoneDisplay,
      address: c.address ?? null,
      city: c.city,
      state: c.state,
      status: c.status as LifecycleStatus,
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
      researchSummary: c.researchSummary,
      notes: c.notes,
      nextFollowUp: c.notes?.match(/\[Next Follow-up Scheduled:\s*([^\]]+)\]/i)?.[1] || null,
    });
  }

  // Sort queue by highest ICP Score first
  queue.sort((a, b) => b.icpScore - a.icpScore);
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

  // 3. Update company lifecycle status and notes
  const updatedNotes = company.notes
    ? `${company.notes}\n[Call ${new Date().toISOString().slice(0, 10)}] ${input.callerNotes}`
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
