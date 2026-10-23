/**
 * Relational schema (PostgreSQL). Runs identically on PGlite (local) and
 * node-postgres (Supabase / any Postgres).
 *
 * Every table carries: id, created_at, updated_at, last_verified_at, status.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { FactMap, Provenance } from "../domain/facts";
import type { RuleConfig } from "../domain/rules";

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/** Shared columns. Each table overrides `status` with its own default. */
const common = (defaultStatus: string) => ({
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: tz("created_at").notNull().defaultNow(),
  updatedAt: tz("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  lastVerifiedAt: tz("last_verified_at"),
  status: text("status").notNull().default(defaultStatus),
});

// ------------------------------------------------------------------ markets
export const markets = pgTable(
  "markets",
  {
    ...common("ACTIVE"),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [uniqueIndex("markets_key_uq").on(t.key)],
);

// ----------------------------------------------------------- research rules
export const researchRules = pgTable(
  "research_rules",
  {
    ...common("ACTIVE"), // ACTIVE | ARCHIVED
    marketId: uuid("market_id")
      .notNull()
      .references(() => markets.id),
    name: text("name").notNull(),
    config: jsonb("config").$type<RuleConfig>().notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    version: integer("version").notNull().default(1),
  },
  (t) => [index("research_rules_market_idx").on(t.marketId)],
);

// ---------------------------------------------------------------- companies
/** Canonical company record. `status` is the LEAD LIFECYCLE stage. */
export const companies = pgTable(
  "companies",
  {
    ...common("DISCOVERED"),
    marketId: uuid("market_id")
      .notNull()
      .references(() => markets.id),
    name: text("name").notNull(),
    nameKey: text("name_key").notNull(),
    website: text("website"),
    domain: text("domain"),
    phoneE164: text("phone_e164"),
    phoneDisplay: text("phone_display"),
    phoneType: text("phone_type").notNull().default("COMPANY_MAIN"),
    address: text("address"),
    addressKey: text("address_key"),
    city: text("city"),
    cityKey: text("city_key"),
    state: text("state"),
    zip: text("zip"),
    country: text("country").notNull().default("United States"),
    /** Current value of each fact, each backed by an evidence row. */
    facts: jsonb("facts").$type<FactMap>().notNull().default({}),
    /** Fields a human has set; automated research may only SUGGEST changes to these. */
    lockedFields: text("locked_fields").array().notNull().default(sql`'{}'::text[]`),
    researchSummary: text("research_summary"),
    researchSummaryAt: tz("research_summary_at"),
    notes: text("notes"),
    discoveredVia: text("discovered_via").notNull().default("manual_entry"),
    approvedAt: tz("approved_at"),
    approvedBy: text("approved_by"),
    assignedMemberId: text("assigned_member_id"),
    assignedMemberName: text("assigned_member_name"),
    lastResearchedAt: tz("last_researched_at"),
  },
  (t) => [
    index("companies_domain_idx").on(t.domain),
    index("companies_phone_idx").on(t.phoneE164),
    index("companies_name_key_idx").on(t.nameKey),
    index("companies_state_idx").on(t.state),
    index("companies_status_idx").on(t.status),
  ],
);

/** Source references live UNDER the canonical record (one company, many sources). */
export const companySourceRefs = pgTable(
  "company_source_refs",
  {
    ...common("ACTIVE"),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerRef: text("provider_ref"),
    url: text("url"),
    /** Raw payload only where the provider's terms allow storing it. */
    raw: jsonb("raw").$type<Record<string, unknown>>(),
    retrievedAt: tz("retrieved_at").notNull().defaultNow(),
    /** Source-specific retention: after this the raw payload must be purged. */
    retentionExpiresAt: tz("retention_expires_at"),
  },
  (t) => [
    index("source_refs_company_idx").on(t.companyId),
    uniqueIndex("source_refs_provider_ref_uq")
      .on(t.provider, t.providerRef)
      .where(sql`${t.providerRef} is not null`),
  ],
);

// ----------------------------------------------------------------- contacts
export const contacts = pgTable(
  "contacts",
  {
    ...common("ACTIVE"),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name"),
    title: text("title"),
    roleClass: text("role_class").notNull().default("other"),
    email: text("email"),
    emailType: text("email_type").notNull().default("UNKNOWN"),
    phoneE164: text("phone_e164"),
    phoneDisplay: text("phone_display"),
    phoneType: text("phone_type").notNull().default("UNKNOWN"),
    verified: boolean("verified").notNull().default(false),
    confidence: real("confidence").notNull().default(0),
    provenance: text("provenance").$type<Provenance>().notNull().default("HUMAN_CONFIRMED"),
    sourceUrl: text("source_url"),
    sourceType: text("source_type").notNull().default("manual_entry"),
    notes: text("notes"),
  },
  (t) => [index("contacts_company_idx").on(t.companyId)],
);

// ----------------------------------------------------------------- evidence
export const evidence = pgTable(
  "evidence",
  {
    ...common("ACTIVE"), // ACTIVE | SUPERSEDED
    /** The "Lead ID". */
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    runId: uuid("run_id"),
    field: text("field").notNull(),
    value: text("value").notNull(),
    sourceUrl: text("source_url"),
    sourceType: text("source_type").notNull(),
    evidenceText: text("evidence_text").notNull(),
    retrievedAt: tz("retrieved_at").notNull().defaultNow(),
    confidence: real("confidence").notNull(),
    provenance: text("provenance").$type<Provenance>().notNull(),
  },
  (t) => [
    index("evidence_company_idx").on(t.companyId),
    index("evidence_company_field_idx").on(t.companyId, t.field),
  ],
);

// -------------------------------------------------------------- lead scores
export const leadScores = pgTable(
  "lead_scores",
  {
    ...common("CURRENT"), // CURRENT | HISTORICAL
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    ruleId: uuid("rule_id").references(() => researchRules.id),
    /** ICP fit (0-100). Kept separate from research confidence. */
    icpScore: integer("icp_score").notNull(),
    researchConfidence: integer("research_confidence").notNull(),
    grade: text("grade"),
    breakdown: jsonb("breakdown").$type<Record<string, unknown>>().notNull().default({}),
    scoredAt: tz("scored_at").notNull().defaultNow(),
  },
  (t) => [index("lead_scores_company_idx").on(t.companyId)],
);

// ------------------------------------------------------------ runs and jobs
export const researchRuns = pgTable("research_runs", {
  ...common("QUEUED"), // QUEUED | RUNNING | COMPLETED | PARTIAL | FAILED | RETRYING | CANCELLED
  marketId: uuid("market_id").references(() => markets.id),
  ruleId: uuid("rule_id").references(() => researchRules.id),
  mode: text("mode").notNull(), // test | small | full | stale | rejected | retry
  dryRun: boolean("dry_run").notNull().default(true),
  limits: jsonb("limits").$type<Record<string, unknown>>().notNull().default({}),
  counters: jsonb("counters").$type<Record<string, number>>().notNull().default({}),
  startedAt: tz("started_at"),
  finishedAt: tz("finished_at"),
  lastError: text("last_error"),
  actor: text("actor"),
});

export const researchJobs = pgTable(
  "research_jobs",
  {
    ...common("QUEUED"),
    runId: uuid("run_id")
      .notNull()
      .references(() => researchRuns.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // discover | research | contacts | enrich | score
    attempt: integer("attempt").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    nextAttemptAt: tz("next_attempt_at"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    result: jsonb("result").$type<Record<string, unknown>>(),
    lastError: text("last_error"),
    startedAt: tz("started_at"),
    finishedAt: tz("finished_at"),
  },
  (t) => [index("research_jobs_run_idx").on(t.runId), index("research_jobs_status_idx").on(t.status)],
);

// ------------------------------------------------------------------ sources
export const sources = pgTable(
  "sources",
  {
    ...common("ACTIVE"),
    key: text("key").notNull(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    requiresApiKey: boolean("requires_api_key").notNull().default(false),
    quota: jsonb("quota").$type<Record<string, unknown>>().notNull().default({}),
    costPerRequestUsd: real("cost_per_request_usd").notNull().default(0),
    requests: integer("requests").notNull().default(0),
    errors: integer("errors").notNull().default(0),
    totalLatencyMs: integer("total_latency_ms").notNull().default(0),
    lastSuccessAt: tz("last_success_at"),
    lastError: text("last_error"),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [uniqueIndex("sources_key_uq").on(t.key)],
);

// ------------------------------------------------------ enrichment requests
export const enrichmentRequests = pgTable(
  "enrichment_requests",
  {
    ...common("QUEUED"),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    provider: text("provider").notNull(),
    creditsUsed: real("credits_used").notNull().default(0),
    costUsd: real("cost_usd").notNull().default(0),
    attempt: integer("attempt").notNull().default(0),
    request: jsonb("request").$type<Record<string, unknown>>().notNull().default({}),
    responseSummary: jsonb("response_summary").$type<Record<string, unknown>>(),
    lastError: text("last_error"),
  },
  (t) => [index("enrichment_company_idx").on(t.companyId)],
);

// ------------------------------------------------------------ Google Sheets
export const googleSheetConnections = pgTable("google_sheet_connections", {
  ...common("DISCONNECTED"), // DISCONNECTED | CONNECTED | ERROR
  /** Non-sensitive account identifier (email) for display. */
  accountId: text("account_id"),
  spreadsheetId: text("spreadsheet_id"),
  spreadsheetTitle: text("spreadsheet_title"),
  worksheet: text("worksheet"),
  /** AES-GCM ciphertext. Decrypted only server-side. Never sent to the browser. */
  encryptedRefreshToken: text("encrypted_refresh_token"),
  scopes: text("scopes"),
  syncMode: text("sync_mode").notNull().default("upsert"), // append | upsert
  syncEnabled: boolean("sync_enabled").notNull().default(false),
  lastSuccessAt: tz("last_success_at"),
  lastError: text("last_error"),
});

export const googleSheetMappings = pgTable(
  "google_sheet_mappings",
  {
    ...common("ACTIVE"),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => googleSheetConnections.id, { onDelete: "cascade" }),
    systemField: text("system_field").notNull(),
    sheetColumn: text("sheet_column").notNull(),
  },
  (t) => [uniqueIndex("sheet_mappings_uq").on(t.connectionId, t.systemField)],
);

// ------------------------------------------------------- approvals / audits
export const approvalActions = pgTable(
  "approval_actions",
  {
    ...common("RECORDED"),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    action: text("action").notNull(), // APPROVE | REJECT | RESTORE
    actor: text("actor").notNull(),
    note: text("note"),
    previousStatus: text("previous_status").notNull(),
    newStatus: text("new_status").notNull(),
    /** Exactly what the reviewer saw when deciding. */
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [index("approval_company_idx").on(t.companyId)],
);

export const exclusions = pgTable(
  "exclusions",
  {
    ...common("ACTIVE"),
    kind: text("kind").notNull(), // domain | name | phone | state
    value: text("value").notNull(),
    reason: text("reason"),
  },
  (t) => [uniqueIndex("exclusions_kind_value_uq").on(t.kind, t.value)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    ...common("RECORDED"),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    companyId: uuid("company_id"),
    oldValue: jsonb("old_value"),
    newValue: jsonb("new_value"),
    details: jsonb("details"),
  },
  (t) => [index("audit_created_idx").on(t.createdAt), index("audit_company_idx").on(t.companyId)],
);

export const systemSettings = pgTable(
  "system_settings",
  {
    ...common("ACTIVE"),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
  },
  (t) => [uniqueIndex("system_settings_key_uq").on(t.key)],
);

/** "AI found a possible update": proposed changes to human-locked fields. */
export const fieldSuggestions = pgTable(
  "field_suggestions",
  {
    ...common("PENDING"), // PENDING | ACCEPTED | REJECTED
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    field: text("field").notNull(),
    currentValue: text("current_value"),
    suggestedValue: text("suggested_value").notNull(),
    suggestedConfidence: real("suggested_confidence").notNull(),
    suggestedProvenance: text("suggested_provenance").$type<Provenance>().notNull(),
    evidenceId: uuid("evidence_id").references(() => evidence.id, { onDelete: "set null" }),
    resolvedBy: text("resolved_by"),
    resolvedAt: tz("resolved_at"),
  },
  (t) => [index("suggestions_company_idx").on(t.companyId)],
);
