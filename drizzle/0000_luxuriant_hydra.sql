CREATE TABLE "approval_actions" (
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
--> statement-breakpoint
CREATE TABLE "audit_logs" (
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
--> statement-breakpoint
CREATE TABLE "companies" (
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
--> statement-breakpoint
CREATE TABLE "company_source_refs" (
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
--> statement-breakpoint
CREATE TABLE "contacts" (
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
--> statement-breakpoint
CREATE TABLE "enrichment_requests" (
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
--> statement-breakpoint
CREATE TABLE "evidence" (
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
--> statement-breakpoint
CREATE TABLE "exclusions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_verified_at" timestamp with time zone,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "field_suggestions" (
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
--> statement-breakpoint
CREATE TABLE "google_sheet_connections" (
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
--> statement-breakpoint
CREATE TABLE "google_sheet_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_verified_at" timestamp with time zone,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"connection_id" uuid NOT NULL,
	"system_field" text NOT NULL,
	"sheet_column" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_scores" (
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
--> statement-breakpoint
CREATE TABLE "markets" (
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
--> statement-breakpoint
CREATE TABLE "research_jobs" (
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
--> statement-breakpoint
CREATE TABLE "research_rules" (
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
--> statement-breakpoint
CREATE TABLE "research_runs" (
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
--> statement-breakpoint
CREATE TABLE "sources" (
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
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_verified_at" timestamp with time zone,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approval_actions" ADD CONSTRAINT "approval_actions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_source_refs" ADD CONSTRAINT "company_source_refs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_requests" ADD CONSTRAINT "enrichment_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_requests" ADD CONSTRAINT "enrichment_requests_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_suggestions" ADD CONSTRAINT "field_suggestions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_suggestions" ADD CONSTRAINT "field_suggestions_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_sheet_mappings" ADD CONSTRAINT "google_sheet_mappings_connection_id_google_sheet_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."google_sheet_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_scores" ADD CONSTRAINT "lead_scores_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_scores" ADD CONSTRAINT "lead_scores_rule_id_research_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."research_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_jobs" ADD CONSTRAINT "research_jobs_run_id_research_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."research_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_jobs" ADD CONSTRAINT "research_jobs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_rules" ADD CONSTRAINT "research_rules_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_runs" ADD CONSTRAINT "research_runs_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_runs" ADD CONSTRAINT "research_runs_rule_id_research_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."research_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_company_idx" ON "approval_actions" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "audit_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_company_idx" ON "audit_logs" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "companies_domain_idx" ON "companies" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "companies_phone_idx" ON "companies" USING btree ("phone_e164");--> statement-breakpoint
CREATE INDEX "companies_name_key_idx" ON "companies" USING btree ("name_key");--> statement-breakpoint
CREATE INDEX "companies_state_idx" ON "companies" USING btree ("state");--> statement-breakpoint
CREATE INDEX "companies_status_idx" ON "companies" USING btree ("status");--> statement-breakpoint
CREATE INDEX "source_refs_company_idx" ON "company_source_refs" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "source_refs_provider_ref_uq" ON "company_source_refs" USING btree ("provider","provider_ref") WHERE "company_source_refs"."provider_ref" is not null;--> statement-breakpoint
CREATE INDEX "contacts_company_idx" ON "contacts" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "enrichment_company_idx" ON "enrichment_requests" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "evidence_company_idx" ON "evidence" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "evidence_company_field_idx" ON "evidence" USING btree ("company_id","field");--> statement-breakpoint
CREATE UNIQUE INDEX "exclusions_kind_value_uq" ON "exclusions" USING btree ("kind","value");--> statement-breakpoint
CREATE INDEX "suggestions_company_idx" ON "field_suggestions" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sheet_mappings_uq" ON "google_sheet_mappings" USING btree ("connection_id","system_field");--> statement-breakpoint
CREATE INDEX "lead_scores_company_idx" ON "lead_scores" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "markets_key_uq" ON "markets" USING btree ("key");--> statement-breakpoint
CREATE INDEX "research_jobs_run_idx" ON "research_jobs" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "research_jobs_status_idx" ON "research_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "research_rules_market_idx" ON "research_rules" USING btree ("market_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sources_key_uq" ON "sources" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "system_settings_key_uq" ON "system_settings" USING btree ("key");