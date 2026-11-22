/**
 * Idempotent baseline seed: structural defaults only (market, default rule, settings).
 * Optimized for zero-latency serverless execution: runs full seed only once per database.
 */
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "./client";
import { markets, researchRules, systemSettings } from "./schema";
import { SEEDED_MARKETS } from "../domain/markets";
import { DEFAULT_DIALER_CONFIG } from "../domain/dialer";
import { DEFAULT_CALLER_SHIFT_CONFIG } from "../domain/focus-queue";

export const DEFAULT_TENANTS = [
  {
    id: "tenant_main",
    name: "Astraventa (Master Workspace)",
    role: "Organization Owner",
    description: "Primary multi-niche lead intelligence and outbound CRM workspace.",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "tenant_agency",
    name: "Outbound Agency Team Alpha",
    role: "Client Campaigns",
    description: "Dedicated workspace for multi-industry outbound sales campaigns.",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];

export const DEFAULT_SETTINGS: Record<string, unknown> = {
  stale_days: 30,
  dry_run_default: true,
  actor_name: "Workspace Owner",
  auto_approval_enabled: false,
  tenants_registry: DEFAULT_TENANTS,
  active_tenant_id: "tenant_main",
  active_market_id: "",
  team_members_registry: [],
  active_member_id: "member_owner",
  dialer_config: DEFAULT_DIALER_CONFIG,
  caller_shift_config: DEFAULT_CALLER_SHIFT_CONFIG,
};

let bootstrappedInProcess = false;

export async function bootstrap(db: Db): Promise<void> {
  if (bootstrappedInProcess && process.env.NODE_ENV !== "test") return;

  // Fast check: if system and all phase migrations are already initialized, return immediately (0 latency)
  try {
    const [version] = await db
      .select({ value: systemSettings.value })
      .from(systemSettings)
      .where(eq(systemSettings.key, "schema_version"))
      .limit(1);

    if (version?.value === "phases_1_6") {
      bootstrappedInProcess = true;
      return;
    }
  } catch {
    // If table doesn't exist yet, proceed with full setup
  }

  // 1. Seed Markets & Default Rules
  for (const m of SEEDED_MARKETS) {
    await db
      .insert(markets)
      .values({
        key: m.key,
        name: m.name,
        description: m.description,
        config: {
          keywords: m.keywords,
          serviceKeys: m.serviceKeys,
          pageHints: m.pageHints,
          category: m.category || m.key,
          icon: m.icon || "building",
          tenantId: m.tenantId || "tenant_main",
        },
      })
      .onConflictDoNothing({ target: markets.key });

    const [market] = await db.select().from(markets).where(eq(markets.key, m.key)).limit(1);
    if (!market) continue;

    const existing = await db
      .select({ id: researchRules.id })
      .from(researchRules)
      .where(and(eq(researchRules.marketId, market.id), eq(researchRules.name, m.defaultRuleName)))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(researchRules).values({
        marketId: market.id,
        name: m.defaultRuleName,
        config: m.defaultRule(),
        isDefault: true,
      });
    }
  }

  // 2. Ensure schema tables and columns exist
  // Phase 3: email_activities table & indexes
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "email_activities" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
        "last_verified_at" timestamp with time zone,
        "status" text DEFAULT 'SENT' NOT NULL,
        "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "contact_id" uuid REFERENCES "contacts"("id") ON DELETE SET NULL,
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
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "email_activities_company_idx" ON "email_activities" ("company_id");`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "email_activities_sent_at_idx" ON "email_activities" ("sent_at");`);
  } catch {}

  // Phase 4: meetings table & indexes
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "meetings" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
        "last_verified_at" timestamp with time zone,
        "status" text DEFAULT 'SCHEDULED' NOT NULL,
        "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
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
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "meetings_company_idx" ON "meetings" ("company_id");`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "meetings_meeting_at_idx" ON "meetings" ("meeting_at");`);
  } catch {}

  // Phase 5: dnc_suggestions table & indexes
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "dnc_suggestions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
        "last_verified_at" timestamp with time zone,
        "status" text DEFAULT 'PENDING' NOT NULL,
        "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
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
        "exclusion_id" uuid REFERENCES "exclusions"("id") ON DELETE SET NULL
      );
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "dnc_suggestions_company_idx" ON "dnc_suggestions" ("company_id");`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "dnc_suggestions_status_idx" ON "dnc_suggestions" ("status");`);
  } catch {}

  // Columns on companies
  try {
    await db.execute(sql`ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "assigned_member_id" text;`);
    await db.execute(sql`ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "assigned_member_name" text;`);
    await db.execute(sql`ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "next_follow_up_at" timestamptz;`);
    await db.execute(sql`ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "pain_identified" text;`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "companies_follow_up_idx" ON "companies" ("next_follow_up_at");`);

    await db.execute(sql`ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "qualification_status" text DEFAULT 'UNQUALIFIED' NOT NULL;`);
    await db.execute(sql`ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "deal_stage" text DEFAULT 'NONE' NOT NULL;`);
    await db.execute(sql`ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "deal_value_usd" integer;`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "companies_qualification_status_idx" ON "companies" ("qualification_status");`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "companies_deal_stage_idx" ON "companies" ("deal_stage");`);
  } catch {}

  // Phase 6 backfill from current lifecycle status (after meetings table is guaranteed to exist)
  try {
    await db.execute(sql`UPDATE "companies" SET "qualification_status" = 'PAIN_IDENTIFIED' WHERE "status" = 'PAIN_FOUND' AND "qualification_status" = 'UNQUALIFIED';`);
    await db.execute(sql`UPDATE "companies" SET "qualification_status" = 'QUALIFIED' WHERE "status" = 'QUALIFIED' AND "qualification_status" = 'UNQUALIFIED';`);
    await db.execute(sql`UPDATE "companies" SET "qualification_status" = 'QUALIFIED', "deal_stage" = 'MEETING_BOOKED' WHERE "status" = 'MEETING_BOOKED' AND "deal_stage" = 'NONE';`);
    await db.execute(sql`UPDATE "companies" SET "qualification_status" = 'QUALIFIED', "deal_stage" = 'DISCOVERY' WHERE "status" = 'DISCOVERY' AND "deal_stage" = 'NONE';`);
    await db.execute(sql`UPDATE "companies" SET "qualification_status" = 'QUALIFIED', "deal_stage" = 'PROPOSAL' WHERE "status" = 'PROPOSAL' AND "deal_stage" = 'NONE';`);
    await db.execute(sql`UPDATE "companies" SET "qualification_status" = 'QUALIFIED', "deal_stage" = 'NEGOTIATION' WHERE "status" = 'PILOT' AND "deal_stage" = 'NONE';`);
    await db.execute(sql`UPDATE "companies" SET "qualification_status" = 'QUALIFIED', "deal_stage" = 'CLOSED_WON' WHERE "status" = 'CLOSED' AND "deal_stage" = 'NONE';`);
    await db.execute(sql`UPDATE "companies" SET "qualification_status" = 'DISQUALIFIED' WHERE "status" = 'LOST' AND "qualification_status" = 'UNQUALIFIED';`);
    await db.execute(sql`UPDATE "companies" SET "deal_stage" = 'CLOSED_LOST' WHERE "status" = 'LOST' AND ("notes" ILIKE '%Meeting Booked%' OR "id" IN (SELECT "company_id" FROM "meetings"));`);
  } catch {}

  // 3. Ensure Row-Level Security (RLS) is enabled on all public tables (Supabase Security Advisor)
  try {
    const tablesRes = (await db.execute(sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
    `)) as any;
    const rows = tablesRes?.rows || tablesRes;
    if (Array.isArray(rows)) {
      for (const row of rows) {
        if (row?.table_name) {
          try {
            await db.execute(sql.raw(`ALTER TABLE public."${row.table_name}" ENABLE ROW LEVEL SECURITY;`));
          } catch {}
        }
      }
    }
  } catch {}

  // 4. Default Settings & Mark Initialized
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await db.insert(systemSettings).values({ key, value }).onConflictDoNothing({ target: systemSettings.key });
  }

  await db
    .insert(systemSettings)
    .values({ key: "system_initialized", value: true })
    .onConflictDoNothing({ target: systemSettings.key });

  await db
    .insert(systemSettings)
    .values({ key: "schema_version", value: "phases_1_6" })
    .onConflictDoUpdate({ target: systemSettings.key, set: { value: "phases_1_6" } });

  bootstrappedInProcess = true;
}
