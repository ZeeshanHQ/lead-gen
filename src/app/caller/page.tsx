import React from "react";
import { getDb } from "@/server/db/client";
import { getCallerQueue } from "@/server/repo/caller";
import { getActiveContext } from "@/server/repo/markets";
import { getActiveTeamMember } from "@/server/repo/team";
import { getSetting } from "@/server/repo/settings";
import { DEFAULT_DIALER_CONFIG, type DialerConfig } from "@/server/domain/dialer";
import { CallerClient } from "./caller-client";

export const dynamic = "force-dynamic";

export default async function CallerQueuePage() {
  const db = await getDb();
  const { market } = await getActiveContext(db);
  const { activeMember, allMembers } = await getActiveTeamMember(db);
  const savedDialer = await getSetting<Partial<DialerConfig>>(
    db,
    "dialer_config"
  );
  const dialerConfig: DialerConfig = {
    ...DEFAULT_DIALER_CONFIG,
    ...(savedDialer || {}),
  };

  const queue = await getCallerQueue(db, market.id);

  return (
    <CallerClient
      key={market.id}
      initialQueue={queue}
      nicheName={market.name}
      dialerConfig={dialerConfig}
      activeActorName={activeMember.name}
      marketId={market.id}
      activeMember={activeMember}
      allMembers={allMembers}
      permissions={activeMember.permissions}
    />
  );
}
