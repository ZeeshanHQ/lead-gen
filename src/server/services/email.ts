export interface SendInviteEmailParams {
  to: string;
  recipientName: string;
  inviterName: string;
  workspaceName: string;
  roleLabel: string;
  nicheScopeLabel: string;
  inviteUrl: string;
}

export interface EmailDispatchResult {
  ok: boolean;
  directSent: boolean;
  provider: "resend" | "none";
  messageId?: string;
  error?: string;
  subject: string;
  bodyText: string;
  mailtoUrl: string;
}

export async function sendInviteEmail(
  params: SendInviteEmailParams
): Promise<EmailDispatchResult> {
  const subject = `Invitation to join ${params.workspaceName} on Astraventa`;

  const bodyText = `Hi ${params.recipientName},

${params.inviterName} has invited you to join the ${params.workspaceName} workspace on Astraventa Lead Intelligence Platform as a ${params.roleLabel}.

Assigned Access: ${params.nicheScopeLabel}

To accept your invitation and activate your account, click the link below:
${params.inviteUrl}

If you have any questions, reply to this email or contact your workspace administrator.

Best regards,
The Astraventa Team`;

  const mailtoUrl = `mailto:${encodeURIComponent(params.to)}?subject=${encodeURIComponent(
    subject
  )}&body=${encodeURIComponent(bodyText)}`;

  const resendApiKey = process.env.RESEND_API_KEY?.trim();
  if (!resendApiKey) {
    return {
      ok: true,
      directSent: false,
      provider: "none",
      subject,
      bodyText,
      mailtoUrl,
    };
  }

  // Attempt direct delivery via Resend API
  try {
    const fromAddress =
      process.env.EMAIL_FROM?.trim() || "Astraventa <onboarding@resend.dev>";
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${subject}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #020617; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f8fafc;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #020617; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 540px; background-color: #0f172a; border: 1px solid #1e293b; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);">
          <tr>
            <td style="padding: 32px 32px 24px 32px; border-bottom: 1px solid #1e293b; text-align: left;">
              <div style="display: inline-block; padding: 4px 10px; background-color: rgba(6, 182, 212, 0.1); border: 1px solid rgba(6, 182, 212, 0.3); border-radius: 20px; font-size: 11px; font-weight: 700; color: #22d3ee; letter-spacing: 0.05em; text-transform: uppercase;">
                Team Invitation
              </div>
              <h1 style="margin: 16px 0 0 0; font-size: 22px; font-weight: 800; color: #ffffff; letter-spacing: -0.02em;">
                Join ${params.workspaceName}
              </h1>
              <p style="margin: 6px 0 0 0; font-size: 13px; color: #94a3b8;">
                Invited by <strong style="color: #e2e8f0;">${params.inviterName}</strong>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 28px 32px; text-align: left;">
              <p style="margin: 0 0 16px 0; font-size: 14px; line-height: 1.6; color: #cbd5e1;">
                Hi <strong>${params.recipientName}</strong>,
              </p>
              <p style="margin: 0 0 24px 0; font-size: 14px; line-height: 1.6; color: #cbd5e1;">
                You've been invited to join the <strong>${params.workspaceName}</strong> workspace on Astraventa Lead Intelligence Platform.
              </p>
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #020617; border: 1px solid #1e293b; border-radius: 12px; margin-bottom: 28px;">
                <tr>
                  <td style="padding: 16px;">
                    <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; font-weight: 600; margin-bottom: 4px;">Assigned Role</div>
                    <div style="font-size: 15px; font-weight: 700; color: #38bdf8; margin-bottom: 8px;">${params.roleLabel}</div>
                    <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; font-weight: 600; margin-bottom: 4px;">Niche Access</div>
                    <div style="font-size: 13px; color: #e2e8f0;">${params.nicheScopeLabel}</div>
                  </td>
                </tr>
              </table>
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 28px;">
                <tr>
                  <td align="center">
                    <a href="${params.inviteUrl}" target="_blank" style="display: inline-block; padding: 14px 28px; background-color: #ffffff; color: #020617; text-decoration: none; font-size: 14px; font-weight: 700; border-radius: 10px; box-shadow: 0 4px 12px rgba(255, 255, 255, 0.15);">
                      Accept Invitation &amp; Open Workspace &rarr;
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin: 0 0 8px 0; font-size: 12px; color: #64748b; line-height: 1.5;">
                Or copy and paste this link into your browser:
              </p>
              <p style="margin: 0; font-size: 11px; font-family: monospace; word-break: break-all; color: #38bdf8;">
                <a href="${params.inviteUrl}" style="color: #38bdf8; text-decoration: underline;">${params.inviteUrl}</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 20px 32px; background-color: #020617; border-top: 1px solid #1e293b; text-align: center;">
              <p style="margin: 0; font-size: 11px; color: #475569;">
                Astraventa Lead Intelligence Platform &bull; Automated B2B Lead Engine
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [params.to],
        subject,
        html,
        text: bodyText,
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: true,
        directSent: false,
        provider: "resend",
        error: (data as any)?.message || `Resend returned HTTP ${res.status}`,
        subject,
        bodyText,
        mailtoUrl,
      };
    }

    return {
      ok: true,
      directSent: true,
      provider: "resend",
      messageId: (data as any)?.id,
      subject,
      bodyText,
      mailtoUrl,
    };
  } catch (err: any) {
    return {
      ok: true,
      directSent: false,
      provider: "resend",
      error: err.message || "Failed to contact Resend API",
      subject,
      bodyText,
      mailtoUrl,
    };
  }
}
