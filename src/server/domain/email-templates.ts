/**
 * Outbound Sales Email Templates for US Real Estate Brokerages & Field Services.
 * CAN-SPAM compliant with clean placeholders and direct, professional value propositions.
 */

export interface EmailTemplateVariables {
  ownerName?: string | null;
  companyName: string;
  senderName?: string | null;
  city?: string | null;
}

export interface EmailTemplateDefinition {
  key: string;
  label: string;
  description: string;
  subject: string;
  bodyText: string;
}

export const EMAIL_TEMPLATES: Record<string, EmailTemplateDefinition> = {
  gatekeeper_intro: {
    key: "gatekeeper_intro",
    label: "Gatekeeper Intro (Referral from Front Desk)",
    description: "Sent after receptionist or assistant provides the business owner's direct email.",
    subject: "Question about lead management at {{companyName}}",
    bodyText: `Hi {{ownerName}},

Your front desk suggested I reach out to you directly regarding how {{companyName}} handles inbound buyer and seller leads.

We help top-performing teams in {{city}} automate lead response times from hours down to under 60 seconds, ensuring no high-intent inquiry goes cold over weekends or evenings.

Would you be open to a brief 10-minute conversation this Thursday or Friday to see how this compares to your current setup?

Best regards,

{{senderName}}
Astraventa Sales Operations
astraventa.com`,
  },

  info_requested: {
    key: "info_requested",
    label: "Info Requested (Overview Deck & Workflow)",
    description: "Sent when a prospect requests an overview by email during a call.",
    subject: "Astraventa AI workflow overview for {{companyName}}",
    bodyText: `Hi {{ownerName}},

Thanks for speaking with me briefly today. As requested, here is the quick overview of how Astraventa helps {{companyName}} capture and qualify inbound leads.

Key benefits our partners see within 14 days:
1. Sub-60-second response to incoming portal and web leads.
2. Automated qualification before passing ready prospects to your agents.
3. 24/7 calendar booking directly into your team's schedule.

I've attached our 1-page overview for your review. Let's touch base for 10 minutes next week once you've had a chance to look it over.

Best regards,

{{senderName}}
Astraventa Sales Operations
astraventa.com`,
  },

  no_reply_followup: {
    key: "no_reply_followup",
    label: "No-Reply Follow-Up (Bump Previous Email)",
    description: "Sent when a previously emailed lead hasn't responded after 2+ business days.",
    subject: "Quick follow-up — {{companyName}} inbound lead handling",
    bodyText: `Hi {{ownerName}},

Following up briefly on my note from earlier this week regarding inbound lead response times at {{companyName}}.

I know you're busy running operations in {{city}}, so I wanted to see if exploring automated qualification and faster lead conversion is a priority for your team this quarter?

If so, what does your calendar look like for a quick 10-minute call next Tuesday?

Best regards,

{{senderName}}
Astraventa Sales Operations
astraventa.com`,
  },

  meeting_confirmation: {
    key: "meeting_confirmation",
    label: "Discovery Meeting Confirmation",
    description: "Sent immediately after booking a discovery or demo call with a prospect.",
    subject: "Confirming our 15-min discovery call — Astraventa x {{companyName}}",
    bodyText: `Hi {{ownerName}},

Thank you for scheduling our 15-minute discovery session! I'm looking forward to learning more about {{companyName}} and sharing how our AI qualification engine can streamline your inbound sales funnel.

We have our call scheduled on your calendar. If you need to reschedule or invite any key team members, feel free to let me know or update the calendar invite directly.

Talk soon,

{{senderName}}
Astraventa Sales Operations
astraventa.com`,
  },
};

/**
 * Renders an email template with variable substitution and sensible fallbacks.
 */
export function renderEmailTemplate(
  templateKey: string,
  vars: EmailTemplateVariables
): { subject: string; bodyText: string } {
  const template = EMAIL_TEMPLATES[templateKey] || EMAIL_TEMPLATES["info_requested"]!;

  const owner = vars.ownerName && vars.ownerName.trim() ? vars.ownerName.trim() : "there";
  const company = vars.companyName && vars.companyName.trim() ? vars.companyName.trim() : "your team";
  const sender = vars.senderName && vars.senderName.trim() ? vars.senderName.trim() : "Astraventa Team";
  const city = vars.city && vars.city.trim() ? vars.city.trim() : "your market";

  const substitute = (text: string) =>
    text
      .replace(/\{\{ownerName\}\}/g, owner)
      .replace(/\{\{companyName\}\}/g, company)
      .replace(/\{\{senderName\}\}/g, sender)
      .replace(/\{\{city\}\}/g, city);

  return {
    subject: substitute(template.subject),
    bodyText: substitute(template.bodyText),
  };
}

export type LeadEmailStatus = "PENDING" | "SENT" | null;

/**
 * Derives the email status ("PENDING" | "SENT" | null) of a lead from its notes history.
 * - PENDING: when the prospect requested info/email and no email has been sent since.
 * - SENT: when an email was dispatched to the prospect.
 */
export function getLeadEmailStatus(lead: {
  notes?: string | null;
  status?: string | null;
}): LeadEmailStatus {
  const notes = lead.notes || "";
  const hasSent = notes.includes("(Email Sent)") || notes.includes("Sent email to");
  const hasRequested =
    notes.includes("Email Requested") ||
    notes.includes("email requested") ||
    notes.includes("send email") ||
    notes.includes("send info");

  if (!hasSent && !hasRequested) {
    return null;
  }

  if (hasSent && !hasRequested) {
    return "SENT";
  }

  if (hasRequested && !hasSent) {
    return "PENDING";
  }

  const sentIdx = Math.min(
    notes.indexOf("(Email Sent)") !== -1 ? notes.indexOf("(Email Sent)") : Infinity,
    notes.indexOf("Sent email to") !== -1 ? notes.indexOf("Sent email to") : Infinity
  );
  const reqIdx = Math.min(
    notes.indexOf("Email Requested") !== -1 ? notes.indexOf("Email Requested") : Infinity,
    notes.indexOf("email requested") !== -1 ? notes.indexOf("email requested") : Infinity,
    notes.indexOf("send email") !== -1 ? notes.indexOf("send email") : Infinity,
    notes.indexOf("send info") !== -1 ? notes.indexOf("send info") : Infinity
  );

  return sentIdx < reqIdx ? "SENT" : "PENDING";
}

