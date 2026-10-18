/**
 * Read models for Review Queue, Approved Leads and Caller Queue.
 * Filtering is done in memory over a lightweight projection. This is deliberate:
 * the product targets few, high-quality leads (hundreds to low thousands), and it keeps
 * every filter unit-testable. Revisit with SQL pushdown if volume ever demands it.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { companies, companySourceRefs, evidence, leadScores } from "../db/schema";
import { type BestContact, pickBestContact } from "../domain/contact";
import { type FactMap, parseEmployeeRange, parseSoftware } from "../domain/facts";
import { type LifecycleStatus, POST_APPROVAL, REVIEWABLE, isStale } from "../domain/lifecycle";
import { getContactsForCompanies, toContactInput } from "./contacts";
import { getStaleDays } from "./settings";

export interface LeadRow {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  website: string | null;
  domain: string | null;
  status: LifecycleStatus;
  phoneDisplay: string | null;
  facts: FactMap;
  icpScore: number | null;
  researchConfidence: number | null;
  grade: string | null;
  owner: { name: string | null; title: string | null; verified: boolean } | null;
  best: BestContact;
  hasDecisionMaker: boolean;
  hasDirectContact: boolean;
  evidenceCount: number;
  lastVerifiedAt: Date | null;
  stale: boolean;
  neverVerified: boolean;
  discoveredVia: string;
  sources: string[];
  researchSummary: string | null;
  notes: string | null;
  createdAt: Date;
  approvedAt: Date | null;
}

export type Scope = "review" | "approved";

export async function loadLeadRows(db: Db, scope: Scope, marketId?: string): Promise<LeadRow[]> {
  const statuses = scope === "review" ? REVIEWABLE : POST_APPROVAL;
  const whereClause = marketId
    ? and(inArray(companies.status, [...statuses]), eq(companies.marketId, marketId))
    : inArray(companies.status, [...statuses]);
  const rows = await db
    .select()
    .from(companies)
    .where(whereClause)
    .orderBy(desc(companies.createdAt));
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const staleDays = await getStaleDays(db);

  const contactMap = await getContactsForCompanies(db, ids);

  const counts = await db
    .select({ companyId: evidence.companyId, n: sql<number>`count(*)::int` })
    .from(evidence)
    .where(inArray(evidence.companyId, ids))
    .groupBy(evidence.companyId);
  const countMap = new Map(counts.map((c) => [c.companyId, Number(c.n)]));

  const scores = await db.select().from(leadScores).where(inArray(leadScores.companyId, ids));
  const scoreMap = new Map<string, (typeof scores)[number]>();
  for (const s of scores) {
    if (s.status !== "CURRENT") continue;
    scoreMap.set(s.companyId, s);
  }

  const refs = await db
    .select({ companyId: companySourceRefs.companyId, provider: companySourceRefs.provider })
    .from(companySourceRefs)
    .where(inArray(companySourceRefs.companyId, ids));
  const refMap = new Map<string, Set<string>>();
  for (const r of refs) {
    const set = refMap.get(r.companyId) ?? new Set<string>();
    set.add(r.provider);
    refMap.set(r.companyId, set);
  }

  return rows.map((r): LeadRow => {
    const cs = contactMap.get(r.id) ?? [];
    const inputs = cs.map(toContactInput);
    const best = pickBestContact(inputs, r.phoneDisplay);
    const ownerC =
      cs.find((c) => ["owner", "president", "founder"].includes(c.roleClass) && c.verified) ??
      cs.find((c) => ["owner", "president", "founder"].includes(c.roleClass));
    const score = scoreMap.get(r.id);
    return {
      id: r.id,
      name: r.name,
      address: r.address ?? null,
      city: r.city,
      state: r.state,
      website: r.website,
      domain: r.domain,
      status: r.status as LifecycleStatus,
      phoneDisplay: r.phoneDisplay,
      facts: r.facts ?? {},
      icpScore: score?.icpScore ?? null,
      researchConfidence: score?.researchConfidence ?? null,
      grade: score?.grade ?? null,
      owner: ownerC ? { name: ownerC.name, title: ownerC.title, verified: ownerC.verified } : null,
      best,
      hasDecisionMaker: inputs.some((c) => c.verified && ["owner", "president", "founder", "general_manager", "operations_manager", "sales_manager"].includes(c.roleClass)),
      hasDirectContact: inputs.some((c) => c.verified && !!c.phone && (c.phoneType === "PUBLISHED_DIRECT" || c.phoneType === "PROFESSIONAL_MOBILE")),
      evidenceCount: countMap.get(r.id) ?? 0,
      lastVerifiedAt: r.lastVerifiedAt,
      stale: isStale(r.lastVerifiedAt, staleDays),
      neverVerified: !r.lastVerifiedAt,
      discoveredVia: r.discoveredVia,
      sources: [...(refMap.get(r.id) ?? [])],
      researchSummary: r.researchSummary,
      notes: r.notes,
      createdAt: r.createdAt,
      approvedAt: r.approvedAt,
    };
  });
}

// ----------------------------------------------------------------- filters --

export interface LeadFilters {
  q?: string;
  status?: string;
  state?: string;
  city?: string;
  minScore?: number;
  minConfidence?: number;
  replacement?: string; // YES | NO | UNKNOWN
  installation?: string;
  financing?: string;
  employeesMin?: number;
  employeesMax?: number;
  decisionMaker?: string; // yes | no
  directContact?: string; // yes | no
  software?: string; // servicetitan | jobber | housecall_pro | other | none
  source?: string;
  verified?: string; // stale | fresh | never
  sort?: string;
}

const norm = (s: string | undefined) => (s ?? "").trim().toLowerCase();

export function applyFilters(rows: LeadRow[], f: LeadFilters): LeadRow[] {
  const q = norm(f.q);
  const out = rows.filter((r) => {
    if (q && !`${r.name} ${r.domain ?? ""} ${r.city ?? ""} ${r.state ?? ""}`.toLowerCase().includes(q)) return false;
    if (f.status && r.status !== f.status) return false;
    if (f.state && norm(r.state ?? "") !== norm(f.state)) return false;
    if (f.city && !norm(r.city ?? "").includes(norm(f.city))) return false;
    if (f.minScore !== undefined && (r.icpScore ?? -1) < f.minScore) return false;
    if (f.minConfidence !== undefined && (r.researchConfidence ?? -1) < f.minConfidence) return false;
    for (const k of ["replacement", "installation", "financing"] as const) {
      const want = f[k];
      if (want && (r.facts[k]?.value ?? "UNKNOWN") !== want) return false;
    }
    if (f.employeesMin !== undefined || f.employeesMax !== undefined) {
      const range = parseEmployeeRange(r.facts.employees?.value);
      if (!range) return false; // unknown size can't satisfy an explicit employee filter
      const lo = f.employeesMin ?? 0;
      const hi = f.employeesMax ?? Number.MAX_SAFE_INTEGER;
      if (range.max < lo || range.min > hi) return false;
    }
    if (f.decisionMaker === "yes" && !r.hasDecisionMaker) return false;
    if (f.decisionMaker === "no" && r.hasDecisionMaker) return false;
    if (f.directContact === "yes" && !r.hasDirectContact) return false;
    if (f.directContact === "no" && r.hasDirectContact) return false;
    if (f.software) {
      const sw = parseSoftware(r.facts.software?.value);
      if (f.software === "none") {
        if (sw.length > 0) return false;
      } else if (!sw.includes(f.software as never)) return false;
    }
    if (f.source && !r.sources.includes(f.source) && r.discoveredVia !== f.source) return false;
    if (f.verified === "stale" && !r.stale) return false;
    if (f.verified === "fresh" && (r.stale || r.neverVerified)) return false;
    if (f.verified === "never" && !r.neverVerified) return false;
    return true;
  });

  const sort = f.sort ?? "newest";
  const gradeOrder = { A: 0, B: 1, C: 2, D: 3 } as const;
  out.sort((a, b) => {
    switch (sort) {
      case "score":
        return (b.icpScore ?? -1) - (a.icpScore ?? -1);
      case "confidence":
        return (b.researchConfidence ?? -1) - (a.researchConfidence ?? -1);
      case "name":
        return a.name.localeCompare(b.name);
      case "caller": // Caller Queue order
        return (
          (b.icpScore ?? -1) - (a.icpScore ?? -1) ||
          gradeOrder[a.best.grade] - gradeOrder[b.best.grade] ||
          Number(b.hasDecisionMaker) - Number(a.hasDecisionMaker) ||
          (b.lastVerifiedAt?.getTime() ?? 0) - (a.lastVerifiedAt?.getTime() ?? 0) ||
          (b.researchConfidence ?? -1) - (a.researchConfidence ?? -1)
        );
      default:
        return b.createdAt.getTime() - a.createdAt.getTime();
    }
  });
  return out;
}

export function parseFilters(sp: Record<string, string | string[] | undefined>): LeadFilters {
  const s = (k: string) => {
    const v = sp[k];
    const x = Array.isArray(v) ? v[0] : v;
    return x && x.trim() !== "" ? x.trim() : undefined;
  };
  const n = (k: string) => {
    const x = s(k);
    if (x === undefined) return undefined;
    const num = Number(x);
    return Number.isFinite(num) ? num : undefined;
  };
  return {
    q: s("q"),
    status: s("status"),
    state: s("state"),
    city: s("city"),
    minScore: n("minScore"),
    minConfidence: n("minConfidence"),
    replacement: s("replacement"),
    installation: s("installation"),
    financing: s("financing"),
    employeesMin: n("employeesMin"),
    employeesMax: n("employeesMax"),
    decisionMaker: s("decisionMaker"),
    directContact: s("directContact"),
    software: s("software"),
    source: s("source"),
    verified: s("verified"),
    sort: s("sort"),
  };
}

export async function distinctStates(db: Db, marketId?: string): Promise<string[]> {
  const whereClause = marketId
    ? and(sql`${companies.state} is not null`, eq(companies.marketId, marketId))
    : sql`${companies.state} is not null`;
  const rows = await db.selectDistinct({ state: companies.state }).from(companies).where(whereClause);
  return rows.map((r) => r.state!).sort();
}

export async function countByStatus(db: Db, marketId?: string): Promise<Record<string, number>> {
  const rows = marketId
    ? await db
        .select({ status: companies.status, n: sql<number>`count(*)::int` })
        .from(companies)
        .where(eq(companies.marketId, marketId))
        .groupBy(companies.status)
    : await db
        .select({ status: companies.status, n: sql<number>`count(*)::int` })
        .from(companies)
        .groupBy(companies.status);
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
}

export { eq };
