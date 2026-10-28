"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/server/db/client";
import { recordCallFeedback, type CallFeedbackInput } from "@/server/repo/caller";
import { getSetting, setSetting, getActor } from "@/server/repo/settings";
import { DEFAULT_DIALER_CONFIG, type DialerConfig } from "@/server/domain/dialer";
import { audit } from "@/server/repo/audit";

export async function logCallFeedbackAction(input: CallFeedbackInput) {
  try {
    const db = await getDb();
    const result = await recordCallFeedback(db, input);

    revalidatePath("/caller");
    revalidatePath("/approved");
    revalidatePath("/review");
    revalidatePath("/sheets");
    revalidatePath("/");
    revalidatePath(`/company/${input.companyId}`);

    return {
      success: true,
      nextStatus: result.nextStatus,
      updatedNotes: result.updatedNotes,
      nextFollowUp: result.nextFollowUp,
    };
  } catch (error: any) {
    console.error("Failed to record call feedback:", error);
    return { success: false, error: error.message || "Failed to record call feedback" };
  }
}

export async function getDialerConfigServer(): Promise<DialerConfig> {
  const db = await getDb();
  const saved = await getSetting<Partial<DialerConfig>>(db, "dialer_config");
  return {
    ...DEFAULT_DIALER_CONFIG,
    ...(saved || {}),
  };
}

export async function saveDialerConfigAction(input: Partial<DialerConfig>) {
  try {
    const db = await getDb();
    const actor = await getActor(db);
    const current = await getDialerConfigServer();
    const updated: DialerConfig = {
      ...current,
      ...input,
      platformName: (input.platformName ?? current.platformName).trim() || "External Dialer",
      launchUrlTemplate:
        (input.launchUrlTemplate ?? current.launchUrlTemplate).trim() || "tel:{phone}",
      webhookUrl: (input.webhookUrl ?? current.webhookUrl).trim(),
      apiKey: (input.apiKey ?? current.apiKey).trim(),
      defaultCampaign: (input.defaultCampaign ?? current.defaultCampaign).trim() || "Outbound Leads",
    };

    await setSetting(db, "dialer_config", updated, actor);
    revalidatePath("/", "layout");
    return { ok: true, config: updated };
  } catch (err: any) {
    return { ok: false, error: err.message || "Could not save dialer settings" };
  }
}

export interface DialerLeadPayload {
  id: string;
  name: string;
  contactName?: string | null;
  contactTitle?: string | null;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  state?: string | null;
  website?: string | null;
  niche?: string | null;
  icpScore?: number | null;
  notes?: string | null;
}

export async function pushLeadsToDialerAction(leads: DialerLeadPayload[]) {
  try {
    const db = await getDb();
    const actor = await getActor(db);
    const config = await getDialerConfigServer();

    if (!leads.length) {
      return { ok: false, error: "No leads selected to send to dialer." };
    }

    const payload = {
      source: "Astraventa CRM",
      platform: config.platformName,
      campaign: config.defaultCampaign,
      sentBy: actor,
      sentAt: new Date().toISOString(),
      count: leads.length,
      leads: leads.map((l) => ({
        leadId: l.id,
        companyName: l.name,
        contactName: l.contactName || "Owner / Manager",
        contactTitle: l.contactTitle || "Decision Maker",
        phone: l.phone || "",
        email: l.email || "",
        city: l.city || "",
        state: l.state || "",
        website: l.website || "",
        niche: l.niche || "",
        score: l.icpScore ?? null,
        notes: l.notes || "",
      })),
    };

    let remoteDelivered = false;
    if (config.webhookUrl && /^https?:\/\//i.test(config.webhookUrl)) {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (config.apiKey) {
        headers["Authorization"] = `Bearer ${config.apiKey}`;
        headers["X-Dialer-Api-Key"] = config.apiKey;
      }

      try {
        const res = await fetch(config.webhookUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
        });
        remoteDelivered = res.ok;
      } catch {
        remoteDelivered = false;
      }
    }

    await audit(db, {
      actor,
      action: "dialer.leads_dispatched",
      entityType: "dialer_sync",
      entityId: config.platformName,
      details: {
        platform: config.platformName,
        campaign: config.defaultCampaign,
        count: leads.length,
        remoteWebhookConfigured: Boolean(config.webhookUrl),
        remoteDelivered,
        leadIds: leads.slice(0, 20).map((l) => l.id),
      },
    });

    revalidatePath("/caller");
    revalidatePath("/");

    return {
      ok: true,
      count: leads.length,
      platformName: config.platformName,
      campaign: config.defaultCampaign,
      remoteDelivered,
      webhookConfigured: Boolean(config.webhookUrl),
    };
  } catch (err: any) {
    return { ok: false, error: err.message || "Could not send leads to dialer" };
  }
}

export async function assignLeadAction(input: {
  companyId: string;
  memberId: string | null;
  memberName: string | null;
}) {
  try {
    const db = await getDb();
    const actor = await getActor(db);
    const { assignLeadToMember } = await import("@/server/repo/caller");
    await assignLeadToMember(db, input.companyId, input.memberId, input.memberName, actor);
    revalidatePath("/caller");
    revalidatePath("/leads");
    revalidatePath("/");
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message || "Failed to assign lead" };
  }
}

export async function autoDistributeLeadsAction(input: { marketId: string }) {
  try {
    const db = await getDb();
    const actor = await getActor(db);
    const { listTeamMembers } = await import("@/server/repo/team");
    const { autoDistributeLeads } = await import("@/server/repo/caller");
    const allMembers = await listTeamMembers(db);
    const callerOnly = allMembers.filter((m) => m.status === "ACTIVE" && m.role === "CALLER");
    const targetPool =
      callerOnly.length > 0
        ? callerOnly
        : allMembers.filter((m) => m.status === "ACTIVE" && m.role !== "VIEWER");
    const activeMembers = targetPool.map((m) => ({ id: m.id, name: m.name }));

    if (activeMembers.length === 0) {
      return { ok: false, error: "No active team members available to assign leads to." };
    }

    const res = await autoDistributeLeads(db, input.marketId, activeMembers, actor);
    revalidatePath("/caller");
    revalidatePath("/leads");
    revalidatePath("/");
    return { ok: true, distributedCount: res.distributedCount, membersCount: activeMembers.length };
  } catch (err: any) {
    return { ok: false, error: err.message || "Failed to distribute leads" };
  }
}

export async function updateLeadCrmDetailsAction(
  input: import("@/server/repo/caller").UpdateLeadCrmInput
) {
  try {
    const db = await getDb();
    const actor = await getActor(db);
    const { updateLeadCrmDetails } = await import("@/server/repo/caller");
    await updateLeadCrmDetails(db, input, actor);
    revalidatePath("/caller");
    revalidatePath("/leads");
    revalidatePath(`/company/${input.companyId}`);
    revalidatePath("/");
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message || "Failed to update lead details" };
  }
}

export async function updateLeadStatusQuickAction(input: {
  companyId: string;
  status: import("@/server/domain/lifecycle").LifecycleStatus;
}) {
  try {
    const db = await getDb();
    const actor = await getActor(db);
    const { updateLeadStatusQuick } = await import("@/server/repo/caller");
    await updateLeadStatusQuick(db, input.companyId, input.status, actor);
    revalidatePath("/caller");
    revalidatePath("/leads");
    revalidatePath(`/company/${input.companyId}`);
    revalidatePath("/");
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message || "Failed to update status" };
  }
}

export async function updateLeadFollowUpAction(input: {
  companyId: string;
  followUpDate: string | null;
  note?: string | null;
}) {
  try {
    const db = await getDb();
    const actor = await getActor(db);
    const { updateLeadFollowUp } = await import("@/server/repo/caller");
    const res = await updateLeadFollowUp(
      db,
      input.companyId,
      input.followUpDate,
      input.note,
      actor
    );
    revalidatePath("/caller");
    revalidatePath("/leads");
    revalidatePath(`/company/${input.companyId}`);
    revalidatePath("/");
    return { ok: true, updatedNotes: res.updatedNotes, nextFollowUp: res.nextFollowUp };
  } catch (err: any) {
    return { ok: false, error: err.message || "Failed to update follow-up" };
  }
}

export async function createManualCrmLeadAction(
  input: import("@/server/repo/caller").CreateManualCrmLeadInput
) {
  try {
    const db = await getDb();
    const actor = await getActor(db);
    const { createManualCrmLead } = await import("@/server/repo/caller");
    const lead = await createManualCrmLead(db, input, actor);
    revalidatePath("/caller");
    revalidatePath("/leads");
    revalidatePath("/");
    return { ok: true, lead };
  } catch (err: any) {
    return { ok: false, error: err.message || "Failed to create lead" };
  }
}

export async function deleteCrmLeadAction(input: { companyId: string }) {
  try {
    const db = await getDb();
    const { getActiveTeamMember } = await import("@/server/repo/team");
    const { activeMember } = await getActiveTeamMember(db);
    const isOwnerOrManager =
      activeMember.role === "OWNER" || Boolean(activeMember.permissions?.manageTeamAndSettings);
    if (!isOwnerOrManager) {
      return { ok: false, error: "Unauthorized: Only workspace owners and managers can delete leads." };
    }
    const actor = activeMember.name || (await getActor(db));
    const { deleteCrmLead } = await import("@/server/repo/caller");
    await deleteCrmLead(db, input.companyId, actor);
    revalidatePath("/caller");
    revalidatePath("/leads");
    revalidatePath("/");
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message || "Failed to remove lead" };
  }
}

export async function updateLeadSmartFieldAction(input: {
  companyId: string;
  fieldKey: string;
  value: string;
}) {
  try {
    const db = await getDb();
    const actor = await getActor(db);
    const { updateLeadSmartField } = await import("@/server/repo/caller");
    await updateLeadSmartField(db, input.companyId, input.fieldKey, input.value, actor);
    revalidatePath("/caller");
    revalidatePath(`/company/${input.companyId}`);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message || "Failed to update field" };
  }
}

export async function addCustomCrmColumnAction(input: {
  marketId: string;
  label: string;
  options: string[];
}) {
  try {
    const db = await getDb();
    const actor = await getActor(db);
    const { addCustomCrmColumn } = await import("@/server/repo/caller");
    const columns = await addCustomCrmColumn(
      db,
      input.marketId,
      input.label,
      input.options,
      actor
    );
    revalidatePath("/caller");
    return { ok: true, columns };
  } catch (err: any) {
    return { ok: false, error: err.message || "Failed to add custom column" };
  }
}

export async function deleteCustomCrmColumnAction(input: {
  marketId: string;
  columnKey: string;
}) {
  try {
    const db = await getDb();
    const actor = await getActor(db);
    const { deleteCustomCrmColumn } = await import("@/server/repo/caller");
    const columns = await deleteCustomCrmColumn(db, input.marketId, input.columnKey, actor);
    revalidatePath("/caller");
    return { ok: true, columns };
  } catch (err: any) {
    return { ok: false, error: err.message || "Failed to delete custom column" };
  }
}

export async function assignBulkLeadsToCallerAction(input: {
  marketId: string;
  memberId: string | null;
  memberName: string | null;
  count?: number;
  onlyUnassigned?: boolean;
}) {
  try {
    const db = await getDb();
    const actor = await getActor(db);
    const { assignBulkLeadsToCaller } = await import("@/server/repo/caller");
    const res = await assignBulkLeadsToCaller(db, {
      ...input,
      actor,
    });
    revalidatePath("/caller");
    revalidatePath("/discover");
    revalidatePath("/");
    return { ok: true, assignedCount: res.assignedCount };
  } catch (err: any) {
    return { ok: false, error: err.message || "Failed to bulk assign leads" };
  }
}

export async function unassignCallerLeadsAction(input: {
  marketId: string;
  memberId: string;
}) {
  try {
    const db = await getDb();
    const actor = await getActor(db);
    const { unassignCallerLeads } = await import("@/server/repo/caller");
    const res = await unassignCallerLeads(db, {
      ...input,
      actor,
    });
    revalidatePath("/caller");
    revalidatePath("/leads");
    revalidatePath("/approved");
    revalidatePath("/");
    return { ok: true, unassignedCount: res.unassignedCount };
  } catch (err: any) {
    return { ok: false, error: err.message || "Failed to unassign leads" };
  }
}
