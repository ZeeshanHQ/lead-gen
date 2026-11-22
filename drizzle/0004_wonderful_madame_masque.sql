CREATE TABLE "meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_verified_at" timestamp with time zone,
	"status" text DEFAULT 'SCHEDULED' NOT NULL,
	"company_id" uuid NOT NULL,
	"meeting_at" timestamp with time zone NOT NULL,
	"platform" text DEFAULT 'ZOOM' NOT NULL,
	"meeting_url" text,
	"attendee_name" text,
	"attendee_email" text,
	"booked_by" text NOT NULL,
	"prep_notes" text,
	"outcome_notes" text,
	"outcome" text
);
--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meetings_company_idx" ON "meetings" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "meetings_meeting_at_idx" ON "meetings" USING btree ("meeting_at");