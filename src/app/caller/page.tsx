import React from "react";
import { redirect } from "next/navigation";
import { getDb } from "@/server/db/client";
import { getCallerQueue, getCustomCrmColumns } from "@/server/repo/caller";
import { getActiveContext } from "@/server/repo/markets";
import { getActiveTeamMember } from "@/server/repo/team";
import { canMemberAccessPath, getDefaultRouteForMember } from "@/server/domain/team";
import { getSetting } from "@/server/repo/settings";
import { DEFAULT_DIALER_CONFIG, type DialerConfig } from "@/server/domain/dialer";
import { DEFAULT_CALLER_SHIFT_CONFIG, type CallerShiftConfig } from "@/server/domain/focus-queue";
import { CallerClient } from "./caller-client";

export const dynamic = "force-dynamic";

export default async function CallerQueuePage({
  searchParams,
}: {
  searchParams?: Promise<{ caller?: string; status?: string; tz?: string; window?: string }>;
}) {
  const db = await getDb();
  const [resolvedParams, { market, allMarkets, rule }, { activeMember, allMembers }, savedDialer, savedShiftConfig] =
    await Promise.all([
      searchParams ? searchParams : Promise.resolve({} as { caller?: string; status?: string; tz?: string; window?: string }),
      getActiveContext(db),
      getActiveTeamMember(db),
      getSetting<Partial<DialerConfig>>(db, "dialer_config"),
      getSetting<Partial<CallerShiftConfig>>(db, "caller_shift_config"),
    ]);

  if (!canMemberAccessPath(activeMember, "/caller")) {
    const fallback = getDefaultRouteForMember(activeMember);
    if (fallback !== "/caller") {
      redirect(fallback);
    }
  }

  const dialerConfig: DialerConfig = {
    ...DEFAULT_DIALER_CONFIG,
    ...(savedDialer || {}),
  };

  const initialShiftConfig: CallerShiftConfig = {
    defaultRule: {
      ...DEFAULT_CALLER_SHIFT_CONFIG.defaultRule,
      ...(savedShiftConfig?.defaultRule || {}),
    },
    callerOverrides: {
      ...(savedShiftConfig?.callerOverrides || {}),
    },
    updatedAt: savedShiftConfig?.updatedAt,
    updatedBy: savedShiftConfig?.updatedBy,
  };

  const isOwnerOrManager =
    activeMember.role === "OWNER" || Boolean(activeMember.permissions.manageTeamAndSettings);

  // Enforce nicheScope === "SELECTED" for callers (Hamda, Saad, etc.) so they ONLY see their assigned niche
  // PRODUCT_MARKETING members bypass niche isolation — they market own products (FBSniper, Astraventa Voice), not industry niches
  let effectiveMarket = market;
  if (
    activeMember.role !== "PRODUCT_MARKETING" &&
    !isOwnerOrManager &&
    activeMember.nicheScope === "SELECTED" &&
    Array.isArray(activeMember.allowedNicheIds) &&
    activeMember.allowedNicheIds.length > 0 &&
    !activeMember.allowedNicheIds.includes(market.id)
  ) {
    const matched = allMarkets.find((m) => activeMember.allowedNicheIds.includes(m.id));
    if (matched) {
      effectiveMarket = matched;
    }
  }

  const formatShortNicheLabel = (m: { key?: string; category?: string; name?: string }) => {
    const k = (m.key || m.category || "").toLowerCase();
    const n = (m.name || "").toLowerCase();
    if (k === "hvac" || n.includes("hvac")) return "HVAC Niche";
    if (k === "realestate" || n.includes("real estate")) return "Real Estate Niche";
    if (k === "airbnb_str" || n.includes("airbnb")) return "Airbnb & STR Niche";
    return m.name || "Target Niche";
  };

  const marketNames: Record<string, string> = {};
  for (const m of allMarkets) {
    marketNames[m.id] = formatShortNicheLabel(m);
  }

  const activeGate = (rule?.config as any)?.gate;
  const [fullQueue, customColumns] = await Promise.all([
    getCallerQueue(db, effectiveMarket.id, activeGate, {
      includeCrossMarketForOwner: false,
      marketNames,
    }),
    getCustomCrmColumns(db, effectiveMarket.id),
  ]);

  const verticalMarkets = allMarkets
    .filter((m) => m.key === "realestate" || m.key === "hvac")
    .map((m) => ({
      id: m.id,
      key: m.key,
      name: m.key === "hvac" ? "HVAC Niche" : "Real Estate Niche",
      count: m.approvedCount ?? m.leadCount ?? 0,
    }));

  // Multi-Caller Isolation & Full Owner Transparency:
  // - OWNER / Team Managers see all leads across the active vertical
  // - CALLER role sees ONLY leads assigned specifically to them in their allowed niche
  const visibleQueue = isOwnerOrManager
    ? fullQueue
    : fullQueue.filter((lead) => lead.assignedMemberId === activeMember.id);

  const shortNicheName = formatShortNicheLabel(effectiveMarket);

  return (
    <CallerClient
      key={`${effectiveMarket.id}_${resolvedParams?.caller || "ALL"}_${resolvedParams?.status || "ALL"}_${resolvedParams?.tz || "ALL"}_${resolvedParams?.window || "ALL"}`}
      initialQueue={visibleQueue}
      initialCallerFilter={resolvedParams?.caller || "ALL"}
      initialStatusFilter={resolvedParams?.status || "ALL"}
      initialTzFilter={resolvedParams?.tz || "ALL"}
      initialWindowFilter={resolvedParams?.window || "ALL"}
      nicheName={shortNicheName}
      nicheCategory={effectiveMarket.category}
      initialCustomColumns={customColumns}
      dialerConfig={dialerConfig}
      initialShiftConfig={initialShiftConfig}
      activeActorName={activeMember.name}
      marketId={effectiveMarket.id}
      verticalMarkets={verticalMarkets}
      activeMember={activeMember}
      allMembers={allMembers}
      permissions={activeMember.permissions}
      initialRuleConfig={(rule?.config as any) || {}}
      canEditRules={isOwnerOrManager || Boolean(activeMember.permissions.editRules)}
    />
  );
}
