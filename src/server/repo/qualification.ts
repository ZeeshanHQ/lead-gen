/**
 * Read model for the "Qualified Leads" workspace.
 * Qualification is recomputed live from the default rule, so changing a rule
 * (filters, min score, required fields) immediately changes the result.
 */
import { and, eq, notInArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { companies } from "../db/schema";
import { resolveCompleteness } from "../domain/completeness";
import type { FactMap } from "../domain/facts";
import { type QualificationResult, type QualificationTier, qualifyLead } from "../domain/qualification";
import type { RuleConfig } from "../domain/rules";
import { type ContactRow, getContactsForCompanies, toContactInput } from "./contacts";
import { getDefaultRule } from "./rules";

export interface QualifiedLeadRow {
  id: string;
  name: string;
  website: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  ownerName: string | null;
  ownerTitle: string | null;
  ownerPhone: string | null;
  ownerEmail: string | null;
  ownerVerified: boolean;
  ownerSourceUrl: string | null;
  anyEmail: string | null;
  employees: string | null;
  status: string;
  qualification: QualificationResult;
  tier: QualificationTier;
}

export interface QualificationReport {
  ruleName: string;
  rule: RuleConfig;
  leads: QualifiedLeadRow[];
  counts: Record<QualificationTier, number>;
}

/** Statuses that are never offered as leads (dead or already rejected). */
const EXCLUDED_STATUSES = ["REJECTED", "LOST", "CLOSED", "RESEARCHING"];

type CompanyRow = typeof companies.$inferSelect;

/** The default rule with the completeness block guaranteed (old saved rules lack it). */
export async function loadActiveRule(db: Db, marketId?: string): Promise<{ name: string; rule: RuleConfig }> {
  const row = await getDefaultRule(db, marketId);
  const cfg = row.config as RuleConfig;
  return { name: row.name, rule: { ...cfg, completeness: resolveCompleteness(cfg.completeness) } };
}

export function buildLeadRow(c: CompanyRow, cs: ContactRow[], rule: RuleConfig): QualifiedLeadRow {
  const inputs = cs.map(toContactInput);
  const qualification = qualifyLead(
    {
      name: c.name,
      website: c.website,
      state: c.state,
      city: c.city,
      zip: c.zip,
      phone: c.phoneDisplay,
      address: c.address,
      facts: (c.facts as FactMap) ?? {},
      contacts: inputs,
      contactResearchDone: true,
    },
    rule,
  );
  const ownerInput = qualification.completeness.owner;
  const ownerRow = ownerInput ? cs.find((x) => x.id === ownerInput.id) : undefined;
  const emp = c.facts?.employees?.value;
  return {
    id: c.id,
    name: c.name,
    website: c.website,
    phone: c.phoneDisplay,
    address: c.address,
    city: c.city,
    state: c.state,
    zip: c.zip,
    ownerName: ownerInput?.name ?? null,
    ownerTitle: ownerInput?.title ?? null,
    ownerPhone: ownerInput?.phone ?? null,
    ownerEmail: ownerInput?.email ?? null,
    ownerVerified: !!ownerInput?.verified,
    ownerSourceUrl: ownerRow?.sourceUrl ?? null,
    anyEmail: inputs.find((x) => !!x.email)?.email ?? null,
    employees: emp && emp !== "UNKNOWN" ? emp : null,
    status: c.status,
    qualification,
    tier: qualification.tier,
  };
}

/** Qualification of ONE company (used by enrichment to re-check after each source). */
export async function loadLeadRowFor(db: Db, companyId: string): Promise<QualifiedLeadRow | null> {
  const [c] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!c) return null;
  const { rule } = await loadActiveRule(db, c.marketId);
  const contactMap = await getContactsForCompanies(db, [companyId]);
  return buildLeadRow(c, contactMap.get(companyId) ?? [], rule);
}

export async function loadQualificationReport(db: Db, marketId?: string): Promise<QualificationReport> {
  const { name: ruleName, rule } = await loadActiveRule(db, marketId);

  const whereClause = marketId
    ? and(notInArray(companies.status, EXCLUDED_STATUSES), eq(companies.marketId, marketId))
    : notInArray(companies.status, EXCLUDED_STATUSES);

  const rows = await db.select().from(companies).where(whereClause);
  const contactMap = await getContactsForCompanies(
    db,
    rows.map((r) => r.id),
  );

  const leads = rows.map((c) => buildLeadRow(c, contactMap.get(c.id) ?? [], rule));

  const counts: Record<QualificationTier, number> = { QUALIFIED: 0, ALMOST: 0, REJECTED: 0 };
  for (const l of leads) counts[l.tier]++;

  // Best first: score, then completeness.
  leads.sort(
    (a, b) =>
      b.qualification.score - a.qualification.score ||
      b.qualification.completeness.pct - a.qualification.completeness.pct ||
      a.name.localeCompare(b.name),
  );

  return { ruleName, rule, leads, counts };
}
