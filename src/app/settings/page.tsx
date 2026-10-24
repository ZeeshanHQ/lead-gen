import React from "react";
import { redirect } from "next/navigation";
import { getDb } from "@/server/db/client";
import { getAllSettings, getSetting } from "@/server/repo/settings";
import { getActiveContext } from "@/server/repo/markets";
import { getActiveTeamMember } from "@/server/repo/team";
import { canMemberAccessPath, getDefaultRouteForMember } from "@/server/domain/team";
import { providerRequirements } from "@/server/env";
import { DEFAULT_DIALER_CONFIG, type DialerConfig } from "@/server/domain/dialer";
import { SettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const db = await getDb();
  const [settings, { allMarkets, tenant }, { activeMember, allMembers }, savedDialer] =
    await Promise.all([
      getAllSettings(db),
      getActiveContext(db),
      getActiveTeamMember(db),
      getSetting<Partial<DialerConfig>>(db, "dialer_config"),
    ]);

  if (!canMemberAccessPath(activeMember, "/settings")) {
    redirect(getDefaultRouteForMember(activeMember));
  }

  const requirements = providerRequirements();
  const dialerConfig: DialerConfig = {
    ...DEFAULT_DIALER_CONFIG,
    ...(savedDialer || {}),
  };

  return (
    <div className="space-y-5">
      <SettingsForm
        initialSettings={settings}
        requirements={requirements}
        initialMembers={allMembers}
        activeMember={activeMember}
        allMarkets={allMarkets}
        activeTenantName={tenant.name}
        initialDialerConfig={dialerConfig}
      />
    </div>
  );
}
