import { NextResponse } from "next/server";
import { getDbHandle } from "@/server/db/client";
import { getActiveContext } from "@/server/repo/markets";
import { listTeamMembers } from "@/server/repo/team";

export const dynamic = "force-dynamic";

/** Never exposes credentials: only host/port/user of DATABASE_URL are reported. */
function describeDatabaseUrl(): Record<string, unknown> {
  const raw = process.env.DATABASE_URL;
  if (!raw) return { configured: false, note: "DATABASE_URL missing, falling back to embedded PGlite" };
  try {
    const u = new URL(raw);
    return {
      configured: true,
      protocol: u.protocol.replace(":", ""),
      host: u.hostname,
      port: u.port || "(default)",
      user: u.username,
    };
  } catch {
    return { configured: true, parseable: false };
  }
}

function rootCause(err: unknown): string {
  let cur: unknown = err;
  let last = "";
  for (let i = 0; i < 6 && cur; i++) {
    if (cur instanceof Error) {
      const code = (cur as { code?: string }).code;
      last = code ? `${code}: ${cur.message}` : cur.message;
      cur = (cur as { cause?: unknown }).cause;
    } else {
      last = String(cur);
      break;
    }
  }
  return last;
}

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
          hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
          hasTavilyKey: Boolean(process.env.TAVILY_API_KEY),
          hasLlmKey: Boolean(process.env.LLM_API_KEY),
          hasResendKey: Boolean(process.env.RESEND_API_KEY),
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
        error: message.split("\n")[0],
        rootCause: rootCause(err),
        databaseUrl: describeDatabaseUrl(),
        environment: {
          vercel: Boolean(process.env.VERCEL),
          nodeEnv: process.env.NODE_ENV || "development",
        },
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
