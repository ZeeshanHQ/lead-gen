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
  markets,
} from "../db/schema";
import { pickBestContact } from "../domain/contact";
import { ALL_FACT_KEYS, FACT_LABELS, type FactKey, type FactMap } from "../domain/facts";
import { type LifecycleStatus, isStale } from "../domain/lifecycle";
import { evaluateRule } from "../domain/rules";
import { getContactsForCompanies, toContactInput } from "./contacts";
import { pendingSuggestions } from "./approvals";
import { getDefaultRule } from "./rules";
import { getStaleDays } from "./settings";
import { getUnifiedCompanyTimeline } from "./timeline";

export { getUnifiedCompanyTimeline };

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
  const timeline = await getUnifiedCompanyTimeline(db, id);
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
    timeline,
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

const HVAC_ONLY_KEYS = new Set<string>([
  "hvac",
  "replacement",
  "installation",
  "indoor_air_quality",
  "multiple_technicians",
  "maintenance_plans",
]);

const REAL_ESTATE_ONLY_KEYS = new Set<string>([
  "str_vacation_rental",
  "casual_host_only",
  "doors_managed",
  "avg_property_value",
  "property_mgmt_software",
  "zillow_advertiser",
  "luxury_high_value",
]);

function getFactQuestion(
  field: string,
  label: string,
  isRealEstate: boolean,
  isHvac: boolean
): string {
  switch (field) {
    case "replacement":
      return isHvac
        ? "Why did the system mark this company as offering HVAC system replacement?"
        : `Where does the "${label}" signal come from?`;
    case "installation":
      return isHvac
        ? "Why did the system mark this company as doing HVAC installation?"
        : `Where does the "${label}" signal come from?`;
    case "financing":
      return "Where was customer financing verified?";
    case "residential":
      return isRealEstate
        ? "Why did the system mark this company as serving residential real estate / properties?"
        : "Why did the system mark this company as residential?";
    case "commercial":
      return isRealEstate
        ? "Why did the system mark this company as serving commercial real estate?"
        : "Why did the system mark this company as commercial?";
    case "employees":
      return "Where does the team / company size signal come from?";
    case "software":
      return "Where does the software / tech-stack signal come from?";
    case "hvac":
      return isHvac
        ? "Why is this company verified as an HVAC contractor?"
        : `Where does the "${label}" verification come from?`;
    case "niche_verified":
      return isHvac
        ? "How was this lead verified as an authentic HVAC contractor?"
        : isRealEstate
        ? "How was this lead verified as an authentic Real Estate / Property operator?"
        : "How was target industry relevance verified?";
    case "website_alive":
      return "Was the company website reachable during live verification?";
    default:
      return `Where does "${label}" come from?`;
  }
}

/** Evidence grouped by field for the Evidence Drawer. Only shows real verified/recorded signals with zero dump rows. */
export async function getEvidenceDrawer(db: Db, companyId: string) {
  const [c] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!c) return null;

  const [all, [marketRow]] = await Promise.all([
    db.select().from(evidence).where(eq(evidence.companyId, companyId)).orderBy(desc(evidence.retrievedAt)),
    db.select({ key: markets.key, name: markets.name, config: markets.config }).from(markets).where(eq(markets.id, c.marketId)).limit(1),
  ]);

  const marketMeta = `${marketRow?.key || ""} ${marketRow?.name || ""} ${(marketRow?.config as any)?.category || ""}`.toLowerCase();
  const isHvac = /\b(hvac|heating|air\s*conditioning|cooling)\b/i.test(marketMeta);
  const isRealEstate = /\b(real\s*estate|realestate|airbnb|str|property|rental)\b/i.test(marketMeta) && !isHvac;

  const facts = (c.facts ?? {}) as FactMap;
  const rowsByField = new Map<string, typeof all>();
  for (const row of all) {
    const list = rowsByField.get(row.field) ?? [];
    list.push(row);
    rowsByField.set(row.field, list);
  }

  const fields = new Set<string>();
  for (const [f, rows] of rowsByField.entries()) {
    if (rows.length > 0) fields.add(f);
  }
  for (const k of ALL_FACT_KEYS) {
    const entry = facts[k];
    if (entry && entry.value && entry.value !== "UNKNOWN" && entry.value !== "NO") {
      fields.add(k);
    }
  }

  // Filter out off-niche legacy dump fields so Real Estate never shows HVAC details (and vice versa)
  const cleanFields = Array.from(fields).filter((field) => {
    const entry = facts[field as FactKey];
    const isHuman = entry?.provenance === "HUMAN_CONFIRMED";
    if (isRealEstate && HVAC_ONLY_KEYS.has(field) && !isHuman) return false;
    if (isHvac && REAL_ESTATE_ONLY_KEYS.has(field) && !isHuman) return false;
    // Never render a field with zero evidence unless it has a genuine non-UNKNOWN/non-NO fact value
    const rows = rowsByField.get(field) ?? [];
    if (rows.length === 0 && (!entry || entry.value === "UNKNOWN" || entry.value === "NO")) return false;
    return true;
  });

  const identity = ["company_name", "website", "company_phone", "address", "city", "state"];
  const factOrder = [...(ALL_FACT_KEYS as readonly string[])];
  const ordered = [
    ...factOrder.filter((f) => cleanFields.includes(f)),
    ...identity.filter((f) => cleanFields.includes(f)),
    ...cleanFields.filter((f) => !factOrder.includes(f) && !identity.includes(f)).sort(),
  ];

  const result: DrawerFact[] = ordered.map((field) => {
    const entry = facts[field as FactKey];
    const rows = rowsByField.get(field) ?? [];
    const label = (FACT_LABELS as Record<string, string>)[field] ?? field.replace(/_/g, " ");
    return {
      field,
      label,
      value: entry?.value ?? rows.find((r) => r.status === "ACTIVE")?.value ?? "UNKNOWN",
      confidence: entry?.confidence ?? null,
      provenance: entry?.provenance ?? null,
      question: getFactQuestion(field, label, isRealEstate, isHvac),
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
