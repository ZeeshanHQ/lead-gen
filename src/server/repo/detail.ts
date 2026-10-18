import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import {
  approvalActions,
  auditLogs,
  companies,
  companySourceRefs,
  contacts,
  evidence,
  leadScores,
} from "../db/schema";
import { pickBestContact } from "../domain/contact";
import { ALL_FACT_KEYS, FACT_LABELS, type FactKey, type FactMap } from "../domain/facts";
import { type LifecycleStatus, isStale } from "../domain/lifecycle";
import { evaluateRule } from "../domain/rules";
import { getContactsForCompanies, toContactInput } from "./contacts";
import { pendingSuggestions } from "./approvals";
import { getDefaultRule } from "./rules";
import { getStaleDays } from "./settings";

export type EvidenceRow = typeof evidence.$inferSelect;

export async function getCompanyDetail(db: Db, id: string) {
  const [c] = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
  if (!c) return null;
  const contactMap = await getContactsForCompanies(db, [id]);
  const cs = contactMap.get(id) ?? [];
  const best = pickBestContact(cs.map(toContactInput), c.phoneDisplay);
  const ev = await db.select().from(evidence).where(eq(evidence.companyId, id)).orderBy(desc(evidence.retrievedAt));
  const approvals = await db.select().from(approvalActions).where(eq(approvalActions.companyId, id)).orderBy(desc(approvalActions.createdAt));
  const refs = await db.select().from(companySourceRefs).where(eq(companySourceRefs.companyId, id));
  const [score] = await db
    .select()
    .from(leadScores)
    .where(and(eq(leadScores.companyId, id), eq(leadScores.status, "CURRENT")))
    .limit(1);
  const suggestions = await pendingSuggestions(db, id);
  const rule = await getDefaultRule(db, c.marketId);
  const evaluation = evaluateRule(
    { name: c.name, website: c.website, state: c.state, city: c.city, zip: c.zip, facts: (c.facts ?? {}) as FactMap, contacts: cs.map(toContactInput), contactResearchDone: false },
    rule.config,
  );
  const staleDays = await getStaleDays(db);
  const history = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.companyId, id))
    .orderBy(desc(auditLogs.createdAt))
    .limit(50);
  return {
    company: c,
    status: c.status as LifecycleStatus,
    facts: (c.facts ?? {}) as FactMap,
    contacts: cs,
    best,
    evidence: ev,
    approvals,
    refs,
    score: score ?? null,
    suggestions,
    evaluation,
    ruleName: rule.name,
    stale: isStale(c.lastVerifiedAt, staleDays),
    staleDays,
    history,
  };
}

export interface DrawerFact {
  field: string;
  label: string;
  value: string;
  confidence: number | null;
  provenance: string | null;
  /** Plain-English question this evidence answers. */
  question: string;
  evidence: {
    id: string;
    value: string;
    text: string;
    sourceUrl: string | null;
    sourceType: string;
    retrievedAt: Date;
    confidence: number;
    provenance: string;
    status: string;
  }[];
}

const QUESTIONS: Partial<Record<FactKey, string>> = {
  replacement: "Why did the system mark this company as a replacement HVAC company?",
  installation: "Why did the system mark this company as doing HVAC installation?",
  financing: "Why did the system mark financing as available?",
  residential: "Why did the system mark this company as residential?",
  employees: "Where does the employee-size signal come from?",
  software: "Where does the software signal come from?",
  hvac: "Why is this company classified as HVAC?",
};

/** Evidence grouped by field for the Evidence Drawer. Includes UNKNOWN facts honestly: no evidence → no row. */
export async function getEvidenceDrawer(db: Db, companyId: string) {
  const [c] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!c) return null;
  const all = await db.select().from(evidence).where(eq(evidence.companyId, companyId)).orderBy(desc(evidence.retrievedAt));
  const facts = (c.facts ?? {}) as FactMap;

  const fields = new Set<string>(all.map((e) => e.field));
  for (const k of ALL_FACT_KEYS) if (facts[k]) fields.add(k);

  const identity = ["company_name", "website", "company_phone", "address", "city", "state"];
  const factOrder = [...ALL_FACT_KEYS as readonly string[]];
  const ordered = [
    ...factOrder.filter((f) => fields.has(f)),
    ...identity.filter((f) => fields.has(f)),
    ...[...fields].filter((f) => !factOrder.includes(f) && !identity.includes(f)).sort(),
  ];

  const result: DrawerFact[] = ordered.map((field) => {
    const entry = facts[field as FactKey];
    const rows = all.filter((e) => e.field === field);
    const label = (FACT_LABELS as Record<string, string>)[field] ?? field.replace(/_/g, " ");
    return {
      field,
      label,
      value: entry?.value ?? rows.find((r) => r.status === "ACTIVE")?.value ?? "UNKNOWN",
      confidence: entry?.confidence ?? null,
      provenance: entry?.provenance ?? null,
      question: QUESTIONS[field as FactKey] ?? `Where does "${label}" come from?`,
      evidence: rows.map((e) => ({
        id: e.id,
        value: e.value,
        text: e.evidenceText,
        sourceUrl: e.sourceUrl,
        sourceType: e.sourceType,
        retrievedAt: e.retrievedAt,
        confidence: e.confidence,
        provenance: e.provenance,
        status: e.status,
      })),
    };
  });
  return { companyId, name: c.name, facts: result, total: all.length };
}

// ------------------------------------------------------------------ stats ---

export async function getOverview(db: Db, marketId?: string) {
  const byStatusRows = marketId
    ? await db
        .select({ status: companies.status, n: sql<number>`count(*)::int` })
        .from(companies)
        .where(eq(companies.marketId, marketId))
        .groupBy(companies.status)
    : await db
        .select({ status: companies.status, n: sql<number>`count(*)::int` })
        .from(companies)
        .groupBy(companies.status);
  const byStatus: Record<string, number> = Object.fromEntries(byStatusRows.map((r) => [r.status, Number(r.n)]));
  const total = byStatusRows.reduce((a, r) => a + Number(r.n), 0);

  const [{ n: evidenceTotal } = { n: 0 }] = marketId
    ? await db
        .select({ n: sql<number>`count(*)::int` })
        .from(evidence)
        .innerJoin(companies, eq(companies.id, evidence.companyId))
        .where(eq(companies.marketId, marketId))
    : await db.select({ n: sql<number>`count(*)::int` }).from(evidence);

  const [{ n: contactTotal } = { n: 0 }] = marketId
    ? await db
        .select({ n: sql<number>`count(*)::int` })
        .from(contacts)
        .innerJoin(companies, eq(companies.id, contacts.companyId))
        .where(and(eq(contacts.status, "ACTIVE"), eq(companies.marketId, marketId)))
    : await db
        .select({ n: sql<number>`count(*)::int` })
        .from(contacts)
        .where(eq(contacts.status, "ACTIVE"));

  const staleDays = await getStaleDays(db);
  const cutoff = new Date(Date.now() - staleDays * 86_400_000);
  const [{ n: staleTotal } = { n: 0 }] = marketId
    ? await db
        .select({ n: sql<number>`count(*)::int` })
        .from(companies)
        .where(sql`${companies.marketId} = ${marketId} and ${companies.lastVerifiedAt} is not null and ${companies.lastVerifiedAt} < ${cutoff}`)
    : await db
        .select({ n: sql<number>`count(*)::int` })
        .from(companies)
        .where(sql`${companies.lastVerifiedAt} is not null and ${companies.lastVerifiedAt} < ${cutoff}`);

  const recent = await db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(8);
  return { total, byStatus, evidenceTotal: Number(evidenceTotal), contactTotal: Number(contactTotal), staleTotal: Number(staleTotal), staleDays, recent };
}

export async function listAudit(db: Db, opts: { q?: string; action?: string; limit?: number } = {}) {
  const limit = Math.min(opts.limit ?? 200, 1000);
  const rows = await db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(limit * 3);
  const q = (opts.q ?? "").toLowerCase();
  return rows
    .filter((r) => !opts.action || r.action === opts.action)
    .filter((r) => !q || JSON.stringify([r.action, r.actor, r.entityType, r.oldValue, r.newValue, r.details]).toLowerCase().includes(q))
    .slice(0, limit);
}

export async function distinctAuditActions(db: Db): Promise<string[]> {
  const rows = await db.selectDistinct({ a: auditLogs.action }).from(auditLogs);
  return rows.map((r) => r.a).sort();
}

export async function listAllContacts(db: Db, marketId?: string) {
  const whereClause = marketId
    ? and(eq(contacts.status, "ACTIVE"), eq(companies.marketId, marketId))
    : eq(contacts.status, "ACTIVE");
  const rows = await db
    .select({ contact: contacts, companyName: companies.name, companyId: companies.id, companyDomain: companies.domain })
    .from(contacts)
    .innerJoin(companies, eq(companies.id, contacts.companyId))
    .where(whereClause)
    .orderBy(desc(contacts.createdAt));
  return rows;
}
