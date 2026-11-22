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
    nextFollowUpAt: tz("next_follow_up_at"),
    painIdentified: text("pain_identified"),
    /** Phase 6 — Structured Qualification & Deal Stage Separation */
    qualificationStatus: text("qualification_status").notNull().default("UNQUALIFIED"),
    dealStage: text("deal_stage").notNull().default("NONE"),
    dealValueUsd: integer("deal_value_usd"),
  },
  (t) => [
    index("companies_domain_idx").on(t.domain),
    index("companies_phone_idx").on(t.phoneE164),
    index("companies_name_key_idx").on(t.nameKey),
    index("companies_state_idx").on(t.state),
    index("companies_status_idx").on(t.status),
    index("companies_follow_up_idx").on(t.nextFollowUpAt),
    index("companies_qualification_status_idx").on(t.qualificationStatus),
    index("companies_deal_stage_idx").on(t.dealStage),
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

export type ActivityStatus = "TODO" | "IN_PROGRESS" | "DONE" | "SKIPPED" | "OVERDUE";
export type ActivityType = "CALL" | "EMAIL" | "MEETING_PREP" | "REVIEW";

/**
 * Phase 2 — Dedicated Activities (Tasks) Table
 * Ensures every active lead has a concrete next action and due date.
 */
export const activities = pgTable(
  "activities",
  {
    ...common("TODO"),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    type: text("type").$type<ActivityType>().notNull(),
    dueAt: tz("due_at"),
    completedAt: tz("completed_at"),
    assignedMemberId: text("assigned_member_id"),
    assignedMemberName: text("assigned_member_name"),
    outcome: text("outcome"),
    notes: text("notes"),
    referenceId: text("reference_id"),
  },
  (t) => [
    index("activities_company_idx").on(t.companyId),
    index("activities_due_at_idx").on(t.dueAt),
    index("activities_assigned_member_idx").on(t.assignedMemberId),
    index("activities_status_idx").on(t.status),
  ],
);

export type EmailActivityStatus = "DRAFT" | "SENT" | "OPENED" | "REPLIED" | "BOUNCED" | "FAILED";

/**
 * Phase 3 — Dedicated Prospect Email Tracking Table
 * Stores outbound emails sent to prospects along with Resend message IDs and delivery state.
 */
export const emailActivities = pgTable(
  "email_activities",
  {
    ...common("SENT"),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    recipientEmail: text("recipient_email").notNull(),
    recipientName: text("recipient_name"),
    templateKey: text("template_key"),
    subject: text("subject").notNull(),
    bodyText: text("body_text").notNull(),
    sentAt: tz("sent_at"),
    resendMessageId: text("resend_message_id"),
    openedAt: tz("opened_at"),
    repliedAt: tz("replied_at"),
    actor: text("actor").notNull(),
    replyText: text("reply_text"),
  },
  (t) => [
    index("email_activities_company_idx").on(t.companyId),
    index("email_activities_sent_at_idx").on(t.sentAt),
  ],
);

export const meetingStatusEnum = ["SCHEDULED", "ATTENDED", "NO_SHOW", "RESCHEDULED", "CANCELLED"] as const;
export type MeetingStatus = (typeof meetingStatusEnum)[number];

export const meetingPlatformEnum = ["ZOOM", "GOOGLE_MEET", "PHONE", "IN_PERSON"] as const;
export type MeetingPlatform = (typeof meetingPlatformEnum)[number];

export const meetingOutcomeEnum = ["QUALIFIED", "NOT_QUALIFIED", "PROPOSAL_SENT", "LOST"] as const;
export type MeetingOutcome = (typeof meetingOutcomeEnum)[number];

/**
 * Phase 4 — Structured Discovery Meetings & Show/No-Show Loop
 * Tracks scheduled demos, attendee contact details, video links, prep notes, and attendance.
 */
export const meetings = pgTable(
  "meetings",
  {
    ...common("SCHEDULED"),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    meetingAt: tz("meeting_at").notNull(),
    platform: text("platform").notNull().default("ZOOM"),
    meetingUrl: text("meeting_url"),
    attendeeName: text("attendee_name"),
    attendeeEmail: text("attendee_email"),
    bookedBy: text("booked_by").notNull(),
    prepNotes: text("prep_notes"),
    outcomeNotes: text("outcome_notes"),
    outcome: text("outcome"),
  },
  (t) => [
    index("meetings_company_idx").on(t.companyId),
    index("meetings_meeting_at_idx").on(t.meetingAt),
  ],
);

export const dncSuggestionStatusEnum = ["PENDING", "ACCEPTED", "DISMISSED"] as const;
export type DncSuggestionStatus = (typeof dncSuggestionStatusEnum)[number];

/**
 * Phase 5 — DNC Automation & Blocklist Suggestions
 * Captures auto-detected DNC requests from call logs with 1-click admin approval.
 */
export const dncSuggestions = pgTable(
  "dnc_suggestions",
  {
    ...common("PENDING"),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    suggestedKind: text("suggested_kind").notNull(), // phone | domain | name
    suggestedValue: text("suggested_value").notNull(),
    companyName: text("company_name").notNull(),
    phone: text("phone"),
    domain: text("domain"),
    callerNotes: text("caller_notes"),
    detectedKeyword: text("detected_keyword"),
    suggestedBy: text("suggested_by").notNull(),
    reviewedBy: text("reviewed_by"),
    reviewedAt: tz("reviewed_at"),
    exclusionId: uuid("exclusion_id").references(() => exclusions.id, { onDelete: "set null" }),
  },
  (t) => [
    index("dnc_suggestions_company_idx").on(t.companyId),
    index("dnc_suggestions_status_idx").on(t.status),
  ],
);

export const qualificationStatusEnum = ["UNQUALIFIED", "PAIN_IDENTIFIED", "QUALIFIED", "DISQUALIFIED"] as const;
export type QualificationStatus = (typeof qualificationStatusEnum)[number];

export const dealStageEnum = [
  "NONE",
  "MEETING_BOOKED",
  "DISCOVERY",
  "PROPOSAL",
  "NEGOTIATION",
  "CLOSED_WON",
  "CLOSED_LOST",
] as const;
export type DealStage = (typeof dealStageEnum)[number];



