import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { getActiveContext } from "@/server/repo/markets";
import { getCallerQueue } from "@/server/repo/caller";
import { listTeamMembers } from "@/server/repo/team";
import { getSetting } from "@/server/repo/settings";
import { DEFAULT_DIALER_CONFIG, type DialerConfig } from "@/server/domain/dialer";
import { deriveCallStatus, STATUS_FILTER_TO_KEY } from "@/server/domain/call-outcomes";

export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
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

/**
 * GET /api/dialer/queue
 * Allows AstraVenta Voice (voice.astraventa.com) or any external dialing platform
 * to pull the live callable lead queue.
 * Optional query params:
 *   - niche: market key or id, or "all" (defaults to active niche)
 *   - caller: caller email, name, or memberId (filters queue to that caller's assigned leads)
 *   - status: e.g. "UNTOUCHED" / "TO_CALL" / "NO_ANSWER" / "FOLLOW_UP" / "ALL"
 *   - limit: max leads to return (defaults to 200, max 1000)
 */
export async function GET(req: NextRequest) {
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

    const [ctx, allMembers] = await Promise.all([
      getActiveContext(db),
      listTeamMembers(db),
    ]);

    const nicheParam = req.nextUrl.searchParams.get("niche")?.trim().toLowerCase();
    const callerParam = req.nextUrl.searchParams.get("caller")?.trim().toLowerCase();
    const statusParam = req.nextUrl.searchParams.get("status")?.trim().toUpperCase();
    const limitParam = Number(req.nextUrl.searchParams.get("limit") || "200");
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 1000) : 200;

    const isAllNiches = nicheParam === "all";
    const targetMarket =
      !isAllNiches && nicheParam
        ? ctx.allMarkets.find(
            (m) => m.key.toLowerCase() === nicheParam || m.id.toLowerCase() === nicheParam
          ) ?? ctx.market
        : ctx.market;

    let queue = await getCallerQueue(db, isAllNiches ? undefined : targetMarket.id);

    // Filter by caller if ?caller= is passed (email, name, or memberId)
    let matchedCaller: { id: string; name: string; email: string } | null = null;
    if (callerParam) {
      const found = allMembers.find(
        (m) =>
          m.id.toLowerCase() === callerParam ||
          m.email.toLowerCase() === callerParam ||
          m.name.toLowerCase() === callerParam ||
          m.name.toLowerCase().includes(callerParam)
      );
      if (found) {
        matchedCaller = { id: found.id, name: found.name, email: found.email };
        queue = queue.filter((l) => l.assignedMemberId === found.id);
      } else {
        queue = queue.filter(
          (l) =>
            (l.assignedMemberId || "").toLowerCase() === callerParam ||
            (l.assignedMemberName || "").toLowerCase().includes(callerParam)
        );
      }
    }

    // Filter by call status if ?status= is passed
    if (statusParam && statusParam !== "ALL") {
      if (statusParam === "FOLLOW_UP") {
        queue = queue.filter(
          (l) => Boolean(l.nextFollowUp) || Boolean(l.notes && l.notes.includes("Follow-up Scheduled"))
        );
      } else {
        const wantedKey = STATUS_FILTER_TO_KEY[statusParam] || statusParam;
        queue = queue.filter((l) => deriveCallStatus(l).key === wantedKey);
      }
    }

    const sliced = queue.slice(0, limit);

    return NextResponse.json(
      {
        ok: true,
        platform: config.platformName,
        campaign: config.defaultCampaign,
        caller: matchedCaller,
        niche: isAllNiches
          ? { id: "all", key: "all", name: "All Workspace Niches" }
          : {
              id: targetMarket.id,
              key: targetMarket.key,
              name: targetMarket.name,
            },
        count: sliced.length,
        leads: sliced.map((l) => {
          const derived = deriveCallStatus(l);
          return {
            leadId: l.companyId,
            companyName: l.name,
            contactName: l.bestContact.name || "Owner / Manager",
            contactTitle: l.bestContact.title || "Decision Maker",
            phone: l.bestContact.phone || l.phone || "",
            companyPhone: l.phone || "",
            email: l.bestContact.email || "",
            linkedinUrl: l.bestContact.linkedinUrl || "",
            address: l.address || "",
            city: l.city || "",
            state: l.state || "",
            website: l.website || "",
            status: l.status,
            callStatus: derived.key,
            callStatusLabel: derived.def.label,
            attempts: derived.attempts,
            score: l.icpScore,
            assignedMemberId: l.assignedMemberId || null,
            assignedMemberName: l.assignedMemberName || null,
            marketName: l.marketName || targetMarket.name,
            nextFollowUp: l.nextFollowUp,
            notes: l.notes || l.researchSummary || "",
            researchSummary: l.researchSummary || "",
          };
        }),
      },
      { headers: CORS_HEADERS }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load dialer queue";
    return NextResponse.json({ ok: false, error: message }, { status: 500, headers: CORS_HEADERS });
  }
}
