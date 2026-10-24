/**
 * Approval gate. Nothing becomes eligible for Google Sheets unless a human
 * explicitly approves it here (auto-approval is a later, opt-in feature and is OFF).
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { approvalActions, companies, evidence, fieldSuggestions, leadScores } from "../db/schema";
import { pickBestContact } from "../domain/contact";
import { type FactMap } from "../domain/facts";
import { type LifecycleStatus, POST_APPROVAL, isSyncEligible } from "../domain/lifecycle";
import { evaluateRule, type RuleEvaluation, matchExclusion } from "../domain/rules";
import { audit } from "./audit";
import { getContactsForCompanies, toContactInput } from "./contacts";
import { listExclusions } from "./exclusions";
import { getDefaultRule } from "./rules";

export class ApprovalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApprovalError";
  }
}

export interface ApprovalSummary {
  companyId: string;
  company: { name: string; website: string | null; city: string | null; state: string | null; status: LifecycleStatus; phone: string | null };
  decisionMaker: { name: string | null; title: string | null; verified: boolean } | null;
  bestContact: ReturnType<typeof pickBestContact>;
  icpScore: number | null;
  researchConfidence: number | null;
  evidenceCount: number;
  topEvidence: { field: string; value: string; text: string; sourceUrl: string | null; provenance: string; confidence: number }[];
  sourceUrls: string[];
  evaluation: RuleEvaluation;
  warnings: string[];
  /** True when the lead has no research evidence beyond what a human typed in. */
  unresearched: boolean;
  excluded: boolean;
}

const INTAKE_FIELDS = new Set(["company_name", "website", "company_phone", "address", "city", "state"]);

export async function getApprovalSummary(db: Db, companyId: string): Promise<ApprovalSummary> {
  const [c] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!c) throw new ApprovalError("Company not found");
  const contactsMap = await getContactsForCompanies(db, [companyId]);
  const cs = contactsMap.get(companyId) ?? [];
  const inputs = cs.map(toContactInput);
  const best = pickBestContact(inputs, c.phoneDisplay);
  const dm =
    cs.find((x) => x.verified && ["owner", "president", "founder"].includes(x.roleClass)) ??
    cs.find((x) => x.verified && ["general_manager", "operations_manager", "sales_manager"].includes(x.roleClass)) ??
    null;

  const ev = await db
    .select()
    .from(evidence)
    .where(and(eq(evidence.companyId, companyId), inArray(evidence.status, ["ACTIVE"])))
    .orderBy(desc(evidence.confidence));
  const [score] = await db
    .select()
    .from(leadScores)
    .where(and(eq(leadScores.companyId, companyId), eq(leadScores.status, "CURRENT")))
    .limit(1);

  const rule = await getDefaultRule(db, c.marketId);
  const evaluation = evaluateRule(
    { name: c.name, website: c.website, state: c.state, city: c.city, zip: c.zip, facts: (c.facts ?? {}) as FactMap, contacts: inputs, contactResearchDone: false },
    rule.config,
  );

  const researchEvidence = ev.filter((e) => !INTAKE_FIELDS.has(e.field) && e.sourceType !== "manual_entry");
  const unresearched = researchEvidence.length === 0;
  const excluded = !!matchExclusion({ name: c.name, website: c.website, phone: c.phoneE164, state: c.state }, await listExclusions(db));

  const warnings: string[] = [];
  if (unresearched) warnings.push("No public-research evidence has been collected for this company. Approving relies only on what was typed in.");
  if (!score) warnings.push("This company has not been scored yet.");
  if (!best.name) warnings.push("No decision maker is on file. Direct phone: NOT FOUND.");
  if (evaluation.verdict === "FAIL") warnings.push("Fails at least one required rule check (see checks below).");
  if (excluded) warnings.push("Matches an active exclusion.");

  const ranked = [...ev].sort((a, b) => {
    const aPub = a.provenance === "PUBLICLY_VERIFIED" ? 1 : 0;
    const bPub = b.provenance === "PUBLICLY_VERIFIED" ? 1 : 0;
    return bPub - aPub || b.confidence - a.confidence;
  });

  return {
    companyId,
    company: { name: c.name, website: c.website, city: c.city, state: c.state, status: c.status as LifecycleStatus, phone: c.phoneDisplay },
    decisionMaker: dm ? { name: dm.name, title: dm.title, verified: dm.verified } : null,
    bestContact: best,
    icpScore: score?.icpScore ?? null,
    researchConfidence: score?.researchConfidence ?? null,
    evidenceCount: ev.length,
    topEvidence: ranked.slice(0, 5).map((e) => ({
      field: e.field,
      value: e.value,
      text: e.evidenceText,
      sourceUrl: e.sourceUrl,
      provenance: e.provenance,
      confidence: e.confidence,
    })),
    sourceUrls: [...new Set(ev.map((e) => e.sourceUrl).filter((u): u is string => !!u))],
    evaluation,
    warnings,
    unresearched,
    excluded,
  };
}

export async function approveCompany(
  db: Db,
  companyId: string,
  opts: {
    actor: string;
    note?: string | null;
    acknowledgeUnresearched?: boolean;
    assignedMemberId?: string | null;
    assignedMemberName?: string | null;
  },
): Promise<void> {
  const [c] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!c) throw new ApprovalError("Company not found");
  const from = (c.status || "NEEDS_REVIEW") as LifecycleStatus;

  await db.transaction(async (tx) => {
    const now = new Date();
    const updatePayload: Record<string, any> = {
      status: "APPROVED",
      approvedAt: now,
      approvedBy: opts.actor,
      updatedAt: now,
    };
    if (opts.assignedMemberId !== undefined) {
      updatePayload.assignedMemberId = opts.assignedMemberId || null;
      updatePayload.assignedMemberName = opts.assignedMemberName || null;
    }
    await tx
      .update(companies)
      .set(updatePayload)
      .where(eq(companies.id, companyId));
    await tx.insert(approvalActions).values({
      companyId,
      action: "APPROVE",
      actor: opts.actor,
      note: opts.note?.trim() || null,
      previousStatus: from,
      newStatus: "APPROVED",
      snapshot: { companyId, name: c.name, status: "APPROVED" },
    });
    await audit(tx, {
      actor: opts.actor,
      action: "lead.approved",
      entityType: "company",
      entityId: companyId,
      companyId,
      oldValue: { status: from },
      newValue: { status: "APPROVED", assignedMemberId: opts.assignedMemberId ?? c.assignedMemberId },
    });
  });
}

export async function rejectCompany(db: Db, companyId: string, opts: { actor: string; reason?: string | null }): Promise<void> {
  const [c] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!c) throw new ApprovalError("Company not found");
  const from = (c.status || "NEEDS_REVIEW") as LifecycleStatus;
  await db.transaction(async (tx) => {
    await tx.update(companies).set({ status: "REJECTED", updatedAt: new Date() }).where(eq(companies.id, companyId));
    await tx.insert(approvalActions).values({
      companyId,
      action: "REJECT",
      actor: opts.actor,
      note: opts.reason?.trim() || null,
      previousStatus: from,
      newStatus: "REJECTED",
      snapshot: {},
    });
    await audit(tx, {
      actor: opts.actor,
      action: "lead.rejected",
      entityType: "company",
      entityId: companyId,
      companyId,
      oldValue: { status: from },
      newValue: { status: "REJECTED" },
      details: { reason: opts.reason ?? null },
    });
  });
}

/** Moves a rejected lead back to the review queue. */
export async function restoreCompany(db: Db, companyId: string, actor: string): Promise<void> {
  const [c] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!c) throw new ApprovalError("Company not found");
  await db.transaction(async (tx) => {
    await tx.update(companies).set({ status: "NEEDS_REVIEW", updatedAt: new Date() }).where(eq(companies.id, companyId));
    await tx.insert(approvalActions).values({ companyId, action: "RESTORE", actor, previousStatus: c.status, newStatus: "NEEDS_REVIEW", snapshot: {} });
    await audit(tx, { actor, action: "lead.restored", entityType: "company", entityId: companyId, companyId, oldValue: { status: c.status }, newValue: { status: "NEEDS_REVIEW" } });
  });
}

/** Single source of truth for "may this lead be written to Google Sheets?" */
export async function listSyncEligibleIds(db: Db, marketId?: string): Promise<string[]> {
  const whereClause = marketId
    ? and(inArray(companies.status, [...POST_APPROVAL]), eq(companies.marketId, marketId))
    : inArray(companies.status, [...POST_APPROVAL]);
  const rows = await db.select({ id: companies.id, status: companies.status }).from(companies).where(whereClause);
  if (rows.length === 0) return [];
  const approved = await db
    .select({ companyId: approvalActions.companyId })
    .from(approvalActions)
    .where(and(eq(approvalActions.action, "APPROVE"), inArray(approvalActions.companyId, rows.map((r) => r.id))));
  const approvedSet = new Set(approved.map((a) => a.companyId));
  return rows
    .filter((r) => isSyncEligible({ status: r.status as LifecycleStatus, hasApprovalRecord: approvedSet.has(r.id) }))
    .map((r) => r.id);
}

export async function pendingSuggestions(db: Db, companyId: string) {
  return db
    .select()
    .from(fieldSuggestions)
    .where(and(eq(fieldSuggestions.companyId, companyId), eq(fieldSuggestions.status, "PENDING")));
}
