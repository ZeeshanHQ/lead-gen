import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { getDb } from "@/server/db/client";
import { getActiveContext, type MarketView, type TenantWorkspace } from "@/server/repo/markets";
import { getActiveTeamMember } from "@/server/repo/team";
import type { TeamMember } from "@/server/domain/team";

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
    const [ctx, teamCtx] = await Promise.all([
      getActiveContext(db),
      getActiveTeamMember(db),
    ]);

    activeTenant = ctx.tenant;
    allTenants = ctx.allTenants;
    activeMarket = ctx.market;
    tenantMarkets = ctx.tenantMarkets;
    allMarkets = ctx.allMarkets;

    activeMember = teamCtx.activeMember;
    allMembers = teamCtx.allMembers;

    reviewCount = ctx.market.reviewCount || 0;
    approvedCount = ctx.market.approvedCount || 0;
    callerCount = ctx.market.approvedCount || 0;
  } catch {
    // Safe fallback if DB is initializing
  }

  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-[#09090b] text-zinc-100 antialiased selection:bg-zinc-700 selection:text-white">
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
