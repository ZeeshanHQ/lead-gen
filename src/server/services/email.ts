export interface SendInviteEmailParams {
  to: string;
  recipientName: string;
  inviterName: string;
  workspaceName: string;
  roleLabel: string;
  nicheScopeLabel: string;
  inviteUrl: string;
}

export interface SendOtpEmailParams {
  to: string;
  recipientName?: string;
  code: string;
  workspaceName?: string;
  magicLinkUrl?: string;
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

${params.inviterName} has invited you to join the ${params.workspaceName} workspace on Astraventa Lead Intelligence CRM as a ${params.roleLabel}.

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
<body style="margin: 0; padding: 0; background-color: #09090b; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f4f4f5;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #09090b; padding: 48px 20px;">
    <tr>
      <td align="center">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 520px; background-color: #121215; border: 1px solid #27272a; border-radius: 16px; overflow: hidden; box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6);">
          <tr>
            <td style="padding: 32px 32px 24px 32px; border-bottom: 1px solid #1f1f23; text-align: left;">
              <div style="font-size: 13px; font-weight: 800; letter-spacing: 0.12em; color: #a1a1aa; text-transform: uppercase; margin-bottom: 12px;">
                ASTRAVENTA &bull; CRM
              </div>
              <h1 style="margin: 0; font-size: 22px; font-weight: 700; color: #ffffff; letter-spacing: -0.02em;">
                Join ${params.workspaceName}
              </h1>
              <p style="margin: 6px 0 0 0; font-size: 13px; color: #71717a;">
                Invited by <strong style="color: #e4e4e7;">${params.inviterName}</strong>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 28px 32px; text-align: left;">
              <p style="margin: 0 0 16px 0; font-size: 14px; line-height: 1.6; color: #d4d4d8;">
                Hi <strong>${params.recipientName}</strong>,
              </p>
              <p style="margin: 0 0 24px 0; font-size: 14px; line-height: 1.6; color: #a1a1aa;">
                You've been invited to join the <strong>${params.workspaceName}</strong> workspace on Astraventa Lead Intelligence CRM.
              </p>
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #09090b; border: 1px solid #27272a; border-radius: 12px; margin-bottom: 28px;">
                <tr>
                  <td style="padding: 16px 20px;">
                    <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #71717a; font-weight: 600; margin-bottom: 4px;">Assigned Role</div>
                    <div style="font-size: 15px; font-weight: 700; color: #ffffff; margin-bottom: 12px;">${params.roleLabel}</div>
                    <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #71717a; font-weight: 600; margin-bottom: 4px;">Niche Access</div>
                    <div style="font-size: 13px; color: #d4d4d8;">${params.nicheScopeLabel}</div>
                  </td>
                </tr>
              </table>
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 28px;">
                <tr>
                  <td align="center">
                    <a href="${params.inviteUrl}" target="_blank" style="display: block; width: 100%; box-sizing: border-box; text-align: center; padding: 14px 24px; background-color: #ffffff; color: #09090b; text-decoration: none; font-size: 14px; font-weight: 700; border-radius: 10px;">
                      Accept Invitation &amp; Open Workspace &rarr;
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin: 0 0 8px 0; font-size: 12px; color: #71717a; line-height: 1.5;">
                Or copy and paste this link into your browser:
              </p>
              <p style="margin: 0; font-size: 11px; font-family: monospace; word-break: break-all; color: #a1a1aa;">
                <a href="${params.inviteUrl}" style="color: #a1a1aa; text-decoration: underline;">${params.inviteUrl}</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 20px 32px; background-color: #09090b; border-top: 1px solid #1f1f23; text-align: center;">
              <p style="margin: 0; font-size: 11px; color: #52525b;">
                Astraventa Lead Intelligence CRM &bull; High-Velocity B2B Calling Platform
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

export async function sendOtpEmail(params: SendOtpEmailParams): Promise<{
  ok: boolean;
  directSent: boolean;
  code: string;
  error?: string;
}> {
  const workspaceName = params.workspaceName || "Astraventa";
  const subject = `${params.code} is your ${workspaceName} verification code`;

  const bodyText = `Hi ${params.recipientName || "there"},

Your single-use sign-in verification code for Astraventa is:

${params.code}

This code will expire in 10 minutes.

If you did not request this verification code, please ignore this email.

Best regards,
The Astraventa Team`;

  const resendApiKey = process.env.RESEND_API_KEY?.trim();
  if (!resendApiKey) {
    return {
      ok: true,
      directSent: false,
      code: params.code,
    };
  }

  try {
    const fromAddress =
      process.env.EMAIL_FROM?.trim() || "Astraventa <security@resend.dev>";
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${subject}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #09090b; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f4f4f5;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #09090b; padding: 48px 20px;">
    <tr>
      <td align="center">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 480px; background-color: #121215; border: 1px solid #27272a; border-radius: 16px; overflow: hidden; box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6);">
          <tr>
            <td style="padding: 32px 32px 20px 32px; border-bottom: 1px solid #1f1f23; text-align: left;">
              <div style="font-size: 13px; font-weight: 800; letter-spacing: 0.12em; color: #a1a1aa; text-transform: uppercase; margin-bottom: 8px;">
                ASTRAVENTA
              </div>
              <h1 style="margin: 0; font-size: 20px; font-weight: 700; color: #ffffff; letter-spacing: -0.02em;">
                Verification Code
              </h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 28px 32px; text-align: left;">
              <p style="margin: 0 0 20px 0; font-size: 14px; line-height: 1.6; color: #d4d4d8;">
                Use the following 6-digit verification code to complete your sign-in:
              </p>
              
              <!-- OTP Box -->
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 24px;">
                <tr>
                  <td align="center" style="background-color: #09090b; border: 1px solid #27272a; border-radius: 12px; padding: 22px 16px;">
                    <span style="font-family: 'Courier New', Courier, monospace, monospace; font-size: 34px; font-weight: 800; letter-spacing: 8px; color: #ffffff; display: inline-block;">
                      ${params.code}
                    </span>
                  </td>
                </tr>
              </table>

              <p style="margin: 0 0 8px 0; font-size: 12px; color: #71717a; line-height: 1.5;">
                &bull; This code is single-use and expires in <strong>10 minutes</strong>.
              </p>
              <p style="margin: 0; font-size: 12px; color: #71717a; line-height: 1.5;">
                &bull; Never share this code with anyone. Astraventa staff will never ask for it.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 20px 32px; background-color: #09090b; border-top: 1px solid #1f1f23; text-align: center;">
              <p style="margin: 0; font-size: 11px; color: #52525b;">
                Astraventa Lead Intelligence CRM &bull; Security &amp; Authentication
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
        code: params.code,
        error: (data as any)?.message || `Resend returned HTTP ${res.status}`,
      };
    }

    return {
      ok: true,
      directSent: true,
      code: params.code,
    };
  } catch (err: any) {
    return {
      ok: true,
      directSent: false,
      code: params.code,
      error: err.message || "Failed to contact Resend API",
    };
  }
}
