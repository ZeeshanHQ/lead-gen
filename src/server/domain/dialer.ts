export interface DialerConfig {
  enabled: boolean;
  platformName: string;
  launchUrlTemplate: string;
  webhookUrl: string;
  apiKey: string;
  defaultCampaign: string;
  autoPushOnApprove: boolean;
}

export const DEFAULT_DIALER_CONFIG: DialerConfig = {
  enabled: true,
  platformName: "AstraVenta Voice (voice.astraventa.com)",
  launchUrlTemplate: "tel:{phone}",
  webhookUrl: "",
  apiKey: "",
  defaultCampaign: "Outbound Leads",
  autoPushOnApprove: false,
};

export function buildDialerLaunchUrl(
  template: string | undefined,
  lead: {
    id: string;
    name: string;
    phone?: string | null;
    contactName?: string | null;
    email?: string | null;
    city?: string | null;
    state?: string | null;
    niche?: string | null;
    caller?: string | null;
  }
): string {
  const cleanPhone = (lead.phone || "").replace(/[^\d+]/g, "");
  const rawTemplate = (template || "tel:{phone}").trim() || "tel:{phone}";

  return rawTemplate
    .replace(/\{phone\}/gi, encodeURIComponent(cleanPhone))
    .replace(/\{raw_phone\}/gi, cleanPhone)
    .replace(/\{company\}/gi, encodeURIComponent(lead.name || ""))
    .replace(/\{name\}/gi, encodeURIComponent(lead.contactName || lead.name || ""))
    .replace(/\{email\}/gi, encodeURIComponent(lead.email || ""))
    .replace(/\{city\}/gi, encodeURIComponent(lead.city || ""))
    .replace(/\{state\}/gi, encodeURIComponent(lead.state || ""))
    .replace(/\{niche\}/gi, encodeURIComponent(lead.niche || ""))
    .replace(/\{caller\}/gi, encodeURIComponent(lead.caller || ""))
    .replace(/\{id\}/gi, encodeURIComponent(lead.id || ""));
}
