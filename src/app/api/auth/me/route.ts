import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { getActiveTeamMember } from "@/server/repo/team";
import { getActiveContext } from "@/server/repo/markets";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = await getDb();
    const [{ activeMember }, ctx] = await Promise.all([
      getActiveTeamMember(db),
      getActiveContext(db),
    ]);

    return NextResponse.json(
      {
        ok: true,
        activeMember,
        activeMarket: ctx.market,
        allMarkets: ctx.allMarkets,
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      }
    );
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "Failed to load session" },
      { status: 500 }
    );
  }
}
