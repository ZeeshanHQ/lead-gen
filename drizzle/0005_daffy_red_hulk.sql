CREATE TABLE "dnc_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_verified_at" timestamp with time zone,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"company_id" uuid NOT NULL,
	"suggested_kind" text NOT NULL,
	"suggested_value" text NOT NULL,
	"company_name" text NOT NULL,
	"phone" text,
	"domain" text,
	"caller_notes" text,
	"detected_keyword" text,
	"suggested_by" text NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"exclusion_id" uuid
);
--> statement-breakpoint
ALTER TABLE "dnc_suggestions" ADD CONSTRAINT "dnc_suggestions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dnc_suggestions" ADD CONSTRAINT "dnc_suggestions_exclusion_id_exclusions_id_fk" FOREIGN KEY ("exclusion_id") REFERENCES "public"."exclusions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dnc_suggestions_company_idx" ON "dnc_suggestions" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "dnc_suggestions_status_idx" ON "dnc_suggestions" USING btree ("status");