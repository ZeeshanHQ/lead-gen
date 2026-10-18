import React from "react";
import { getDb } from "@/server/db/client";
import { getAllSettings, getSetting } from "@/server/repo/settings";
import { getActiveContext } from "@/server/repo/markets";
import { getActiveTeamMember } from "@/server/repo/team";
import { providerRequirements } from "@/server/env";
import { DEFAULT_DIALER_CONFIG, type DialerConfig } from "@/server/domain/dialer";
import { SettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const db = await getDb();
  const settings = await getAllSettings(db);
  const requirements = providerRequirements();
  const { allMarkets, tenant } = await getActiveContext(db);
  const { activeMember, allMembers } = await getActiveTeamMember(db);
  const savedDialer = await getSetting<Partial<DialerConfig>>(
    db,
    "dialer_config"
  );
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
