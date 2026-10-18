import { NextResponse } from "next/server";
import { getDbHandle } from "@/server/db/client";
import { getActiveContext } from "@/server/repo/markets";
import { listTeamMembers } from "@/server/repo/team";

export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();
  try {
    const handle = await getDbHandle();
    const [ctx, members] = await Promise.all([
      getActiveContext(handle.db),
      listTeamMembers(handle.db),
    ]);

    return NextResponse.json(
      {
        ok: true,
        status: "healthy",
        database: {
          connected: true,
          driver: handle.driver,
          latencyMs: Date.now() - startedAt,
        },
        workspace: {
          tenantId: ctx.tenant.id,
          tenantName: ctx.tenant.name,
          activeNicheId: ctx.market.id,
          activeNicheKey: ctx.market.key,
          activeNicheName: ctx.market.name,
          totalNiches: ctx.allMarkets.length,
          teamMembersCount: members.length,
        },
        environment: {
          vercel: Boolean(process.env.VERCEL),
          nodeEnv: process.env.NODE_ENV || "development",
        },
        timestamp: new Date().toISOString(),
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Database health check failed";
    return NextResponse.json(
      {
        ok: false,
        status: "unhealthy",
        error: message,
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
