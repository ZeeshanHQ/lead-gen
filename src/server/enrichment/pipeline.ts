/**
 * Enrichment pipeline: runs the free sources in order of trust/cost and STOPS
 * as soon as the lead has everything the rules require. After every source the
 * qualification is recomputed from the database, so the report always shows
 * what really changed.
 */
import type { Db } from "../db/client";
import { loadLeadRowFor, loadQualificationReport, type QualifiedLeadRow } from "../repo/qualification";
import { applyFindings } from "./apply";
import { createHttpContext } from "./http";
import { websiteDeepSource, waybackSource } from "./sources/web";
import { socialProfileSource } from "./sources/social";
import { openDataRegistrySource } from "./sources/registries";
import { rdapSource } from "./sources/rdap";
import { osmSource } from "./sources/osm";
import type { EnrichmentContext, EnrichmentSource, EnrichmentTarget } from "./types";
import { isValidEmail } from "../domain/contact";

/** Order = trust first, then cost: own site, social profiles, official registries, domain registry, open maps, archive. */
export const ENRICHMENT_SOURCES: EnrichmentSource[] = [
  websiteDeepSource,
  socialProfileSource,
  openDataRegistrySource,
  rdapSource,
  osmSource,
  waybackSource,
];

export interface SourceReport {
  id: string;
  name: string;
  status: "ran" | "skipped" | "error";
  findings: number;
  applied: string[];
  error?: string;
}

export interface EnrichmentReport {
  companyId: string;
  name: string;
  tierBefore: string;
  tierAfter: string;
  missingBefore: string[];
  missingAfter: string[];
  sources: SourceReport[];
  note?: string;
}

export interface EnrichOptions {
  ctx?: EnrichmentContext;
  sources?: EnrichmentSource[];
  actor?: string;
  /** Wall-clock budget per lead. */
  budgetMs?: number;
}

function toTarget(row: QualifiedLeadRow, domain: string | null, contactsHaveEmail: boolean): EnrichmentTarget {
  return {
    companyId: row.id,
    name: row.name,
    website: row.website,
    domain,
    address: row.address,
    city: row.city,
    state: row.state,
    zip: row.zip,
    phone: row.phone,
    missing: row.qualification.missing,
    hasOwner: !!row.ownerName,
    hasEmail: contactsHaveEmail,
  };
}

const domainOf = (website: string | null) => {
  try {
    return website ? new URL(website).hostname.replace(/^www\./, "").toLowerCase() : null;
  } catch {
    return null;
  }
};

export async function enrichCompany(db: Db, companyId: string, opts: EnrichOptions = {}): Promise<EnrichmentReport> {
  const ctx = opts.ctx ?? createHttpContext();
  const sources = opts.sources ?? ENRICHMENT_SOURCES;
  const actor = opts.actor ?? "Enrichment Engine";
  const deadline = Date.now() + (opts.budgetMs ?? 60_000);

  let row = await loadLeadRowFor(db, companyId);
  if (!row) throw new Error(`Company ${companyId} not found`);

  const report: EnrichmentReport = {
    companyId,
    name: row.name,
    tierBefore: row.tier,
    tierAfter: row.tier,
    missingBefore: row.qualification.missing,
    missingAfter: row.qualification.missing,
    sources: [],
  };

  if (row.tier === "REJECTED") {
    report.note = "Rejected by your filters, so no enrichment was attempted.";
    return report;
  }

  for (const src of sources) {
    if (row.qualification.missing.length === 0) {
      report.note = "Nothing left to find; stopped early.";
      break;
    }
    if (Date.now() > deadline) {
      report.note = "Time budget reached; run again to continue.";
      break;
    }
    const entry: SourceReport = { id: src.meta.id, name: src.meta.name, status: "skipped", findings: 0, applied: [] };
    report.sources.push(entry);

    const emailPresent = !!row.anyEmail && isValidEmail(row.anyEmail);
    const target = toTarget(row, row.website ? domainOf(row.website) : null, emailPresent);
    if (!src.appliesTo(target)) continue;

    try {
      const findings = await src.run(target, ctx);
      entry.status = "ran";
      entry.findings = findings.length;
      entry.applied = (await applyFindings(db, companyId, findings, actor)).applied;
    } catch (err) {
      entry.status = "error";
      entry.error = err instanceof Error ? err.message : String(err);
    }
    const next = await loadLeadRowFor(db, companyId);
    if (next) row = next;
  }

  report.tierAfter = row.tier;
  report.missingAfter = row.qualification.missing;
  return report;
}

/** Enrich the best ALMOST leads (closest to complete first). */
export async function enrichAlmostQualified(db: Db, opts: EnrichOptions & { limit?: number } = {}): Promise<EnrichmentReport[]> {
  const { leads } = await loadQualificationReport(db);
  const targets = leads
    .filter((l) => l.tier === "ALMOST" && !!l.website)
    .sort((a, b) => b.qualification.completeness.pct - a.qualification.completeness.pct)
    .slice(0, opts.limit ?? 5);
  const reports: EnrichmentReport[] = [];
  for (const t of targets) reports.push(await enrichCompany(db, t.id, opts));
  return reports;
}
