import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { eq, ilike, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { companies, contacts } from "@/server/db/schema";
import { recordCallFeedback, type CallFeedbackInput } from "@/server/repo/caller";
import { listTeamMembers } from "@/server/repo/team";
import { getSetting } from "@/server/repo/settings";
import { DEFAULT_DIALER_CONFIG, type DialerConfig } from "@/server/domain/dialer";
import { inferOutcomeFromText, outcomeKeyFromEnum } from "@/server/domain/call-outcomes";

export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-dialer-api-key",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

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

function mapExternalOutcome(
  rawOutcome?: string,
  amdResult?: string,
  notes?: string
): CallFeedbackInput["callOutcome"] {
  const direct = outcomeKeyFromEnum(rawOutcome) || inferOutcomeFromText(rawOutcome);
  if (direct) return direct;

  const norm = (rawOutcome || "").trim().toUpperCase();
  if (norm.includes("MEETING") || norm.includes("BOOKED") || norm.includes("APPOINTMENT") || norm.includes("DEMO")) {
    return "MEETING_BOOKED";
  }
  if (norm.includes("NOT_INTERESTED") || norm.includes("DECLINE") || norm.includes("DNC") || norm.includes("REJECT")) {
    return "NOT_INTERESTED";
  }
  if (norm.includes("GATEKEEPER") || norm.includes("RECEPTION") || norm.includes("FRONT_DESK")) {
    return "GATEKEEPER_BLOCKED";
  }
  if (norm.includes("WRONG") || norm.includes("INVALID") || norm.includes("BAD_NUMBER") || norm.includes("UNALLOCATED")) {
    return "WRONG_NUMBER";
  }
  if (norm.includes("VOICEMAIL") || norm.includes("VM") || norm.includes("MACHINE")) {
    return "CALL_COMPLETED";
  }
  if (norm.includes("NO_ANSWER") || norm.includes("BUSY") || norm.includes("UNANSWERED") || norm.includes("TIMEOUT")) {
    return "NO_ANSWER";
  }
  if (norm.includes("CONNECT") || norm.includes("SPOKE") || norm.includes("ANSWERED") || norm.includes("HUMAN")) {
    return "CONNECTED";
  }

  const amd = (amdResult || "").trim().toLowerCase();
  if (amd === "machine" || amd === "voicemail") return "CALL_COMPLETED";
  if (amd === "no_answer" || amd === "busy" || amd === "timeout") return "NO_ANSWER";
  if (amd === "human") return "CONNECTED";

  const fromNotes = inferOutcomeFromText(notes);
  if (fromNotes) return fromNotes;

  return "CALL_COMPLETED";
}

/**
 * POST /api/dialer/webhook
 * Receives live call outcomes, Telnyx hangup/disposition events, recordings, and notes
 * from AstraVenta Voice (voice.astraventa.com) or any external dialing platform
 * and updates the matching CRM lead + Sales Funnel analytics in real time.
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
        { status: 401, headers: CORS_HEADERS }
      );
    }

    const body = (await req.json().catch(() => ({}))) as {
      leadId?: string;
      companyId?: string;
      companyName?: string;
      phone?: string;
      to?: string;
      destinationNumber?: string;
      outcome?: string;
      callOutcome?: string;
      disposition?: string;
      amdResult?: string;
      durationSec?: number;
      recordingUrl?: string;
      notes?: string;
      callerNotes?: string;
      nextFollowUp?: string;
      actor?: string;
      callerEmail?: string;
      callerName?: string;
      painIdentified?: string;
      softwareConfirmed?: string;
      fleetSizeConfirmed?: number;
    };

    let targetCompanyId = (body.leadId || body.companyId || "").trim();

    // 1. Fallback lookup by dialed phone number (e.g. from Telnyx call.hangup / voice.astraventa.com)
    const rawDialedPhone = (body.phone || body.to || body.destinationNumber || "").trim();
    if (!targetCompanyId && rawDialedPhone) {
      const digits = rawDialedPhone.replace(/\D/g, "");
      const last10 = digits.length >= 10 ? digits.slice(-10) : digits;
      if (last10.length >= 7) {
        const [byCompanyPhone] = await db
          .select({ id: companies.id })
          .from(companies)
          .where(
            sql`regexp_replace(coalesce(${companies.phoneE164}, ${companies.phoneDisplay}, ''), '[^0-9]', '', 'g') LIKE ${"%" + last10}`
          )
          .limit(1);

        if (byCompanyPhone) {
          targetCompanyId = byCompanyPhone.id;
        } else {
          const [byContactPhone] = await db
            .select({ companyId: contacts.companyId })
            .from(contacts)
            .where(
              sql`regexp_replace(coalesce(${contacts.phoneE164}, ''), '[^0-9]', '', 'g') LIKE ${"%" + last10}`
            )
            .limit(1);
          if (byContactPhone) {
            targetCompanyId = byContactPhone.companyId;
          }
        }
      }
    }

    // 2. Fallback lookup by companyName
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
          error: "Missing leadId (or matching phone / companyName) in webhook payload.",
        },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const [existing] = await db
      .select({ id: companies.id, assignedMemberName: companies.assignedMemberName })
      .from(companies)
      .where(eq(companies.id, targetCompanyId))
      .limit(1);

    if (!existing) {
      return NextResponse.json(
        { ok: false, error: `Lead with id "${targetCompanyId}" was not found.` },
        { status: 404, headers: CORS_HEADERS }
      );
    }

    // Resolve caller identity from callerEmail / callerName / actor or assigned caller on the lead
    let resolvedActor = (body.callerName || body.actor || "").trim();
    if (!resolvedActor && body.callerEmail) {
      const allMembers = await listTeamMembers(db);
      const foundCaller = allMembers.find(
        (m) => m.email.toLowerCase() === body.callerEmail!.trim().toLowerCase()
      );
      if (foundCaller) {
        resolvedActor = foundCaller.name;
      } else {
        resolvedActor = body.callerEmail.trim();
      }
    }
    if (!resolvedActor) {
      resolvedActor = existing.assignedMemberName || config.platformName || "AstraVenta Voice";
    }

    const rawOutcomeStr = body.callOutcome || body.outcome || body.disposition;
    const rawNotes = (body.callerNotes || body.notes || "").trim();
    const mappedOutcome = mapExternalOutcome(rawOutcomeStr, body.amdResult, rawNotes);

    const metaParts: string[] = [];
    if (typeof body.durationSec === "number" && body.durationSec > 0) {
      const mins = Math.floor(body.durationSec / 60);
      const secs = body.durationSec % 60;
      metaParts.push(`Duration: ${mins > 0 ? `${mins}m ` : ""}${secs}s`);
    }
    if (body.recordingUrl) {
      metaParts.push(`Recording: ${body.recordingUrl}`);
    }

    const baseNoteText =
      rawNotes ||
      (metaParts.length > 0
        ? `Call logged via ${config.platformName} (${metaParts.join(" • ")})`
        : `Call logged via ${config.platformName}`);
    const noteWithMeta =
      rawNotes && metaParts.length > 0 ? `${rawNotes} (${metaParts.join(" • ")})` : baseNoteText;

    const finalNotes = body.nextFollowUp
      ? `${noteWithMeta} [Next Follow-up Scheduled: ${body.nextFollowUp.trim()}]`
      : noteWithMeta;

    const result = await recordCallFeedback(db, {
      companyId: targetCompanyId,
      actor: resolvedActor,
      callOutcome: mappedOutcome,
      painIdentified: body.painIdentified || null,
      softwareConfirmed: body.softwareConfirmed || null,
      fleetSizeConfirmed: body.fleetSizeConfirmed || null,
      callerNotes: finalNotes,
      followUpDate: body.nextFollowUp?.trim() || null,
    });

    try {
      revalidatePath("/caller");
      revalidatePath("/analytics");
      revalidatePath("/leads");
      revalidatePath("/usage");
      revalidatePath("/");
    } catch {
      // Safe fallback in test or non-request contexts
    }

    return NextResponse.json(
      {
        ok: true,
        companyId: targetCompanyId,
        actor: resolvedActor,
        recordedOutcome: mappedOutcome,
        nextStatus: result.nextStatus,
      },
      { headers: CORS_HEADERS }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to process dialer webhook";
    return NextResponse.json({ ok: false, error: message }, { status: 500, headers: CORS_HEADERS });
  }
}
