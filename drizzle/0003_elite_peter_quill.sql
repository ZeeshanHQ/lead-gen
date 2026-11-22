CREATE TABLE "email_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_verified_at" timestamp with time zone,
	"status" text DEFAULT 'SENT' NOT NULL,
	"company_id" uuid NOT NULL,
	"contact_id" uuid,
	"recipient_email" text NOT NULL,
	"recipient_name" text,
	"template_key" text,
	"subject" text NOT NULL,
	"body_text" text NOT NULL,
	"sent_at" timestamp with time zone,
	"resend_message_id" text,
	"opened_at" timestamp with time zone,
	"replied_at" timestamp with time zone,
	"actor" text NOT NULL,
	"reply_text" text
);
--> statement-breakpoint
ALTER TABLE "email_activities" ADD CONSTRAINT "email_activities_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_activities" ADD CONSTRAINT "email_activities_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_activities_company_idx" ON "email_activities" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "email_activities_sent_at_idx" ON "email_activities" USING btree ("sent_at");