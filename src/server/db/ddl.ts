/**
 * Bundled PostgreSQL schema DDL.
 * Ensures PGlite (local & serverless fallback) can initialize all tables
 * and indexes even if migrations folder is not present in deployment bundle.
 */
export const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS "approval_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_verified_at" timestamp with time zone,
	"status" text DEFAULT 'RECORDED' NOT NULL,
	"company_id" uuid NOT NULL,
	"action" text NOT NULL,
	"actor" text NOT NULL,
	"note" text,
	"previous_status" text NOT NULL,
	"new_status" text NOT NULL,
	"snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_verified_at" timestamp with time zone,
	"status" text DEFAULT 'RECORDED' NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"company_id" uuid,
	"old_value" jsonb,
	"new_value" jsonb,
	"details" jsonb
);
CREATE TABLE IF NOT EXISTS "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_verified_at" timestamp with time zone,
	"status" text DEFAULT 'DISCOVERED' NOT NULL,
	"market_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"website" text,
	"domain" text,
	"phone_e164" text,
	"phone_display" text,
	"phone_type" text DEFAULT 'COMPANY_MAIN' NOT NULL,
	"address" text,
	"address_key" text,
	"city" text,
	"city_key" text,
	"state" text,
	"zip" text,
	"country" text DEFAULT 'United States' NOT NULL,
	"facts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"locked_fields" text[] DEFAULT '{}'::text[] NOT NULL,
	"research_summary" text,
	"research_summary_at" timestamp with time zone,
	"notes" text,
	"discovered_via" text DEFAULT 'manual_entry' NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by" text,
	"last_researched_at" timestamp with time zone
);
CREATE TABLE IF NOT EXISTS "company_source_refs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_verified_at" timestamp with time zone,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"company_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_ref" text,
	"url" text,
	"raw" jsonb,
	"retrieved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retention_expires_at" timestamp with time zone
);
CREATE TABLE IF NOT EXISTS "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_verified_at" timestamp with time zone,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text,
	"title" text,
	"role_class" text DEFAULT 'other' NOT NULL,
	"email" text,
	"email_type" text DEFAULT 'UNKNOWN' NOT NULL,
	"phone_e164" text,
	"phone_display" text,
	"phone_type" text DEFAULT 'UNKNOWN' NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"confidence" real DEFAULT 0 NOT NULL,
	"provenance" text DEFAULT 'HUMAN_CONFIRMED' NOT NULL,
	"source_url" text,
	"source_type" text DEFAULT 'manual_entry' NOT NULL,
	"notes" text
);
CREATE TABLE IF NOT EXISTS "enrichment_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_verified_at" timestamp with time zone,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"company_id" uuid NOT NULL,
	"contact_id" uuid,
	"provider" text NOT NULL,
	"credits_used" real DEFAULT 0 NOT NULL,
	"cost_usd" real DEFAULT 0 NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"request" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"response_summary" jsonb,
	"last_error" text
);
CREATE TABLE IF NOT EXISTS "evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_verified_at" timestamp with time zone,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"company_id" uuid NOT NULL,
	"contact_id" uuid,
	"run_id" uuid,
	"field" text NOT NULL,
	"value" text NOT NULL,
	"source_url" text,
	"source_type" text NOT NULL,
	"evidence_text" text NOT NULL,
	"retrieved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confidence" real NOT NULL,
	"provenance" text NOT NULL
);
CREATE TABLE IF NOT EXISTS "exclusions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_verified_at" timestamp with time zone,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"reason" text
);
CREATE TABLE IF NOT EXISTS "field_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_verified_at" timestamp with time zone,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"company_id" uuid NOT NULL,
	"field" text NOT NULL,
	"current_value" text,
	"suggested_value" text NOT NULL,
	"suggested_confidence" real NOT NULL,
	"suggested_provenance" text NOT NULL,
	"evidence_id" uuid,
	"resolved_by" text,
	"resolved_at" timestamp with time zone
);
CREATE TABLE IF NOT EXISTS "google_sheet_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_verified_at" timestamp with time zone,
	"status" text DEFAULT 'DISCONNECTED' NOT NULL,
	"account_id" text,
	"spreadsheet_id" text,
	"spreadsheet_title" text,
	"worksheet" text,
	"encrypted_refresh_token" text,
	"scopes" text,
	"sync_mode" text DEFAULT 'upsert' NOT NULL,
	"sync_enabled" boolean DEFAULT false NOT NULL,
	"last_success_at" timestamp with time zone,
	"last_error" text
);
CREATE TABLE IF NOT EXISTS "google_sheet_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_verified_at" timestamp with time zone,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"connection_id" uuid NOT NULL,
	"system_field" text NOT NULL,
	"sheet_column" text NOT NULL
);
CREATE TABLE IF NOT EXISTS "lead_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_verified_at" timestamp with time zone,
	"status" text DEFAULT 'CURRENT' NOT NULL,
	"company_id" uuid NOT NULL,
	"rule_id" uuid,
	"icp_score" integer NOT NULL,
	"research_confidence" integer NOT NULL,
	"grade" text,
	"breakdown" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"scored_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "markets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_verified_at" timestamp with time zone,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS "research_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_verified_at" timestamp with time zone,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"run_id" uuid NOT NULL,
	"company_id" uuid,
	"kind" text NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb,
	"last_error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
CREATE TABLE IF NOT EXISTS "research_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_verified_at" timestamp with time zone,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"market_id" uuid NOT NULL,
	"name" text NOT NULL,
	"config" jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
CREATE TABLE IF NOT EXISTS "research_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_verified_at" timestamp with time zone,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"market_id" uuid,
	"rule_id" uuid,
	"mode" text NOT NULL,
	"dry_run" boolean DEFAULT true NOT NULL,
	"limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"counters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"last_error" text,
	"actor" text
);
CREATE TABLE IF NOT EXISTS "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_verified_at" timestamp with time zone,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"requires_api_key" boolean DEFAULT false NOT NULL,
	"quota" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cost_per_request_usd" real DEFAULT 0 NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	"errors" integer DEFAULT 0 NOT NULL,
	"total_latency_ms" integer DEFAULT 0 NOT NULL,
	"last_success_at" timestamp with time zone,
	"last_error" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS "system_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_verified_at" timestamp with time zone,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "markets_key_uq" ON "markets" ("key");
CREATE UNIQUE INDEX IF NOT EXISTS "sources_key_uq" ON "sources" ("key");
CREATE UNIQUE INDEX IF NOT EXISTS "system_settings_key_uq" ON "system_settings" ("key");
CREATE INDEX IF NOT EXISTS "companies_domain_idx" ON "companies" ("domain");
CREATE INDEX IF NOT EXISTS "companies_phone_idx" ON "companies" ("phone_e164");
CREATE INDEX IF NOT EXISTS "companies_state_idx" ON "companies" ("state");
CREATE INDEX IF NOT EXISTS "companies_status_idx" ON "companies" ("status");
CREATE INDEX IF NOT EXISTS "contacts_company_idx" ON "contacts" ("company_id");
CREATE INDEX IF NOT EXISTS "evidence_company_idx" ON "evidence" ("company_id");
CREATE INDEX IF NOT EXISTS "lead_scores_company_idx" ON "lead_scores" ("company_id");
CREATE INDEX IF NOT EXISTS "research_rules_market_idx" ON "research_rules" ("market_id");
`;
