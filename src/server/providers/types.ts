import type { RuleConfig } from "@/server/domain/rules";

export interface ProviderMetadata {
  id: string;
  name: string;
  category: "user_upload" | "directory" | "government" | "places" | "enrichment" | "search";
  description: string;
  requiresApiKey: boolean;
  attributionNotice?: string;
  retentionPolicyDays?: number;
  costPerRequestUsd: number;
}

export interface DiscoveryQuery {
  rule: RuleConfig;
  keywords: string[];
  states: string[];
  cities: string[];
  zips: string[];
  limit: number;
  excludeDomains?: string[];
  queryOffset?: number;
}

export interface DiscoveredCandidate {
  name: string;
  website?: string | null;
  phone?: string | null;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  provider: string;
  providerRef?: string | null;
  sourceUrl?: string | null;
  rawPayload?: Record<string, unknown>;
}

export interface DiscoveryAdapter {
  metadata: ProviderMetadata;
  isConfigured(config: Record<string, unknown>): boolean;
  discover(query: DiscoveryQuery, config: Record<string, unknown>): Promise<DiscoveredCandidate[]>;
}
