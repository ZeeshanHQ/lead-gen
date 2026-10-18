import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { getDb } from "@/server/db/client";
import { countByStatus } from "@/server/repo/queue";
import { getActiveContext, type MarketView, type TenantWorkspace } from "@/server/repo/markets";
import { getActiveTeamMember } from "@/server/repo/team";
import type { TeamMember } from "@/server/domain/team";
import { REVIEWABLE, POST_APPROVAL } from "@/server/domain/lifecycle";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Astraventa Lead Intelligence & Qualification Engine",
  description: "Multi-Tenant & Multi-Niche Outbound Sales Intelligence & Qualification Platform",
  icons: {
    icon: "/logo.png",
    shortcut: "/logo.png",
    apple: "/logo.png",
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let reviewCount = 0;
  let approvedCount = 0;
  let callerCount = 0;
  let activeTenant: TenantWorkspace | undefined;
  let allTenants: TenantWorkspace[] = [];
  let activeMarket: MarketView | undefined;
  let tenantMarkets: MarketView[] = [];
  let allMarkets: MarketView[] = [];
  let activeMember: TeamMember | undefined;
  let allMembers: TeamMember[] = [];

  try {
    const db = await getDb();
    const ctx = await getActiveContext(db);
    activeTenant = ctx.tenant;
    allTenants = ctx.allTenants;
    activeMarket = ctx.market;
    tenantMarkets = ctx.tenantMarkets;
    allMarkets = ctx.allMarkets;

    const teamCtx = await getActiveTeamMember(db);
    activeMember = teamCtx.activeMember;
    allMembers = teamCtx.allMembers;

    const counts = await countByStatus(db, ctx.market.id);
    for (const [st, n] of Object.entries(counts)) {
      if (REVIEWABLE.includes(st as any)) reviewCount += n;
      if (POST_APPROVAL.includes(st as any)) approvedCount += n;
      if (["APPROVED", "SYNCED", "CALLING", "CONNECTED", "PAIN_FOUND", "MEETING_BOOKED", "QUALIFIED"].includes(st)) callerCount += n;
    }
  } catch (err) {
    // If DB is initializing or empty, safe fallback
  }

  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased selection:bg-slate-700 selection:text-white">
        <AppShell
          reviewCount={reviewCount}
          approvedCount={approvedCount}
          callerCount={callerCount}
          activeTenant={activeTenant}
          allTenants={allTenants}
          activeMarket={activeMarket}
          tenantMarkets={tenantMarkets}
          allMarkets={allMarkets}
          activeMember={activeMember}
          allMembers={allMembers}
        >
          {children}
        </AppShell>
      </body>
    </html>
  );
}
