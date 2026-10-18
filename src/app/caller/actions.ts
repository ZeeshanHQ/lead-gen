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

    return { success: true, nextStatus: result.nextStatus };
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
        // Even if remote webhook is offline in local dev, record the dialer dispatch cleanly
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
