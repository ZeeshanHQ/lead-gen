import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { getActiveContext } from "@/server/repo/markets";
import { getCallerQueue } from "@/server/repo/caller";
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

/**
 * GET /api/dialer/queue
 * Allows an external dialing platform to pull the live callable lead queue.
 * Optional query params:
 *   - niche: market key or id (defaults to active niche)
 *   - limit: max leads to return (defaults to 200)
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
        { status: 401 }
      );
    }

    const ctx = await getActiveContext(db);
    const nicheParam = req.nextUrl.searchParams.get("niche")?.trim().toLowerCase();
    const limitParam = Number(req.nextUrl.searchParams.get("limit") || "200");
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 1000) : 200;

    const targetMarket = nicheParam
      ? ctx.allMarkets.find(
          (m) => m.key.toLowerCase() === nicheParam || m.id.toLowerCase() === nicheParam
        ) ?? ctx.market
      : ctx.market;

    const queue = await getCallerQueue(db, targetMarket.id);
    const sliced = queue.slice(0, limit);

    return NextResponse.json({
      ok: true,
      platform: config.platformName,
      campaign: config.defaultCampaign,
      niche: {
        id: targetMarket.id,
        key: targetMarket.key,
        name: targetMarket.name,
      },
      count: sliced.length,
      leads: sliced.map((l) => ({
        leadId: l.companyId,
        companyName: l.name,
        contactName: l.bestContact.name || "Owner / Manager",
        contactTitle: l.bestContact.title || "Decision Maker",
        phone: l.bestContact.phone || l.phone || "",
        companyPhone: l.phone || "",
        email: l.bestContact.email || "",
        address: l.address || "",
        city: l.city || "",
        state: l.state || "",
        website: l.website || "",
        status: l.status,
        score: l.icpScore,
        nextFollowUp: l.nextFollowUp,
        notes: l.notes || l.researchSummary || "",
      })),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load dialer queue";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
