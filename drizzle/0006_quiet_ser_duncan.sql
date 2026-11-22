ALTER TABLE "companies" ADD COLUMN "qualification_status" text DEFAULT 'UNQUALIFIED' NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "deal_stage" text DEFAULT 'NONE' NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "deal_value_usd" integer;--> statement-breakpoint
CREATE INDEX "companies_qualification_status_idx" ON "companies" USING btree ("qualification_status");--> statement-breakpoint
CREATE INDEX "companies_deal_stage_idx" ON "companies" USING btree ("deal_stage");