ALTER TABLE "companies" ADD COLUMN "assigned_member_id" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "assigned_member_name" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "next_follow_up_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "pain_identified" text;--> statement-breakpoint
CREATE INDEX "companies_follow_up_idx" ON "companies" USING btree ("next_follow_up_at");