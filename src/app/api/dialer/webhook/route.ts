import { NextRequest, NextResponse } from "next/server";
import { eq, ilike } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { companies } from "@/server/db/schema";
import { recordCallFeedback, type CallFeedbackInput } from "@/server/repo/caller";
import { getSetting } from "@/server/repo/settings";
import { DEFAULT_DIALER_CONFIG, type DialerConfig } from "@/server/domain/dialer";

export const dynamic = "force-dynamic";

function isAuthorized(req: NextRequest, expectedKey: string): boolean {
  if (!expectedKey || !expectedKey.trim()) return true;
  const authHeader = req.headers.get("authorization") || "";
  const apiKeyHeader = req.headers.get("x-dialer-api-key") || "";
  const queryKey = req.nextUrl.searchParams.get("apiKey") || "";

  const bearerToken = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";

  return (
    bearerToken === expectedKey.trim() ||
    apiKeyHeader.trim() === expectedKey.trim() ||
    queryKey.trim() === expectedKey.trim()
  );
}

function mapExternalOutcome(rawOutcome?: string): CallFeedbackInput["callOutcome"] {
  const norm = (rawOutcome || "").trim().toUpperCase();
  if (norm.includes("MEETING") || norm.includes("BOOKED") || norm.includes("APPOINTMENT")) {
    return "MEETING_BOOKED";
  }
  if (norm.includes("CONNECT") || norm.includes("ANSWERED") || norm.includes("INTERESTED")) {
    return "CONNECTED";
  }
  if (norm.includes("GATEKEEPER") || norm.includes("RECEPTION")) {
    return "GATEKEEPER_BLOCKED";
  }
  if (norm.includes("WRONG") || norm.includes("INVALID") || norm.includes("BAD_NUMBER")) {
    return "WRONG_NUMBER";
  }
  if (norm.includes("NO_ANSWER") || norm.includes("VOICEMAIL") || norm.includes("BUSY")) {
    return "NO_ANSWER";
  }
  return "CALL_COMPLETED";
}

/**
 * POST /api/dialer/webhook
 * Receives call outcomes and notes from an external dialing platform
 * and updates the matching CRM lead automatically.
 */
export async function POST(req: NextRequest) {
  try {
    const db = await getDb();
    const savedDialer = await getSetting<Partial<DialerConfig>>(db, "dialer_config");
    const config: DialerConfig = {
      ...DEFAULT_DIALER_CONFIG,
      ...(savedDialer || {}),
    };

    if (!isAuthorized(req, config.apiKey)) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized: Invalid or missing dialer API key." },
        { status: 401 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as {
      leadId?: string;
      companyId?: string;
      companyName?: string;
      outcome?: string;
      callOutcome?: string;
      notes?: string;
      callerNotes?: string;
      nextFollowUp?: string;
      actor?: string;
      painIdentified?: string;
      softwareConfirmed?: string;
      fleetSizeConfirmed?: number;
    };

    let targetCompanyId = (body.leadId || body.companyId || "").trim();

    if (!targetCompanyId && body.companyName) {
      const [foundByName] = await db
        .select({ id: companies.id })
        .from(companies)
        .where(ilike(companies.name, body.companyName.trim()))
        .limit(1);
      if (foundByName) {
        targetCompanyId = foundByName.id;
      }
    }

    if (!targetCompanyId) {
      return NextResponse.json(
        {
          ok: false,
          error: "Missing leadId (or matching companyName) in webhook payload.",
        },
        { status: 400 }
      );
    }

    const [existing] = await db
      .select({ id: companies.id })
      .from(companies)
      .where(eq(companies.id, targetCompanyId))
      .limit(1);

    if (!existing) {
      return NextResponse.json(
        { ok: false, error: `Lead with id "${targetCompanyId}" was not found.` },
        { status: 404 }
      );
    }

    const mappedOutcome = mapExternalOutcome(body.callOutcome || body.outcome);
    const rawNotes = (body.callerNotes || body.notes || "Call logged from external dialer").trim();
    const finalNotes = body.nextFollowUp
      ? `${rawNotes} [Next Follow-up Scheduled: ${body.nextFollowUp.trim()}]`
      : rawNotes;

    const result = await recordCallFeedback(db, {
      companyId: targetCompanyId,
      actor: (body.actor || `${config.platformName} Webhook`).trim(),
      callOutcome: mappedOutcome,
      painIdentified: body.painIdentified || null,
      softwareConfirmed: body.softwareConfirmed || null,
      fleetSizeConfirmed: body.fleetSizeConfirmed || null,
      callerNotes: finalNotes,
    });

    return NextResponse.json({
      ok: true,
      companyId: targetCompanyId,
      recordedOutcome: mappedOutcome,
      nextStatus: result.nextStatus,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to process dialer webhook";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
