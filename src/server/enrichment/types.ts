/**
 * Multi-source enrichment: every source is FREE (no API key) and returns
 * FINDINGS with a source URL. A finding is a claim with provenance, never a
 * guess. The pipeline decides what to store.
 */
import type { SourceType } from "../domain/facts";

export interface EnrichmentTarget {
  companyId: string;
  name: string;
  website: string | null;
  domain: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  /** Labels of what is still missing (from the qualification gate). */
  missing: string[];
  hasOwner: boolean;
  hasEmail: boolean;
}

export interface ContactFinding {
  kind: "contact";
  name: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  confidence: number;
  /** Source itself proves the person holds the role (official record / current own website). */
  verified: boolean;
  sourceUrl: string;
  sourceType: SourceType;
  evidenceText: string;
}

export interface CompanyFieldFinding {
  kind: "company_field";
  field: "phone" | "address" | "city" | "state" | "zip";
  value: string;
  confidence: number;
  sourceUrl: string;
  sourceType: SourceType;
  evidenceText: string;
}

export type Finding = ContactFinding | CompanyFieldFinding;

export interface HttpResult {
  ok: boolean;
  status: number;
  url: string;
  text: string;
}

/** Injectable network layer so every source can be tested offline. */
export interface EnrichmentContext {
  fetchText(url: string, opts?: { respectRobots?: boolean }): Promise<HttpResult | null>;
  fetchJson<T = unknown>(url: string, init?: { method?: string; body?: string; headers?: Record<string, string> }): Promise<T | null>;
}

export interface EnrichmentSourceMeta {
  id: string;
  name: string;
  description: string;
  /** What this source can supply. */
  provides: string[];
}

export interface EnrichmentSource {
  meta: EnrichmentSourceMeta;
  appliesTo(target: EnrichmentTarget): boolean;
  run(target: EnrichmentTarget, ctx: EnrichmentContext): Promise<Finding[]>;
}
