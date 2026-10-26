import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/server/db/client";
import { markMemberInactive } from "@/server/repo/team";
import { getSessionMemberId } from "@/server/auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    let memberId = await getSessionMemberId();
    try {
      const body = await req.json();
      if (body?.memberId) {
        memberId = body.memberId;
      }
    } catch {
      // Ignore JSON parse errors
    }

    if (memberId && memberId !== "guest") {
      const db = await getDb();
      await markMemberInactive(db, memberId);
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message }, { status: 500 });
  }
}
