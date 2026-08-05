import { getSecret } from "./env";
import { EMAIL_NOT_CONFIGURED_MESSAGE } from "./http";

/**
 * Sends the verification code by email. The code is never logged and never
 * returned in an API response — the email is the ONLY channel it travels on.
 */
export async function sendVerificationCodeEmail(email: string, code: string): Promise<void> {
  const apiKey = getSecret("BREVO_API_KEY");
  if (!apiKey) {
    throw new Error(EMAIL_NOT_CONFIGURED_MESSAGE);
  }

  const senderEmail = getSecret("BREVO_SENDER_EMAIL") ?? "aether.verify@outlook.com";
  const senderName = getSecret("BREVO_SENDER_NAME") ?? "Aether";

  const htmlContent = buildCodeEmailHtml(code);

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      accept: "application/json",
      "api-key": apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      sender: { email: senderEmail, name: senderName },
      to: [{ email }],
      subject: "Your Aether verification code",
      htmlContent,
    }),
  });

  if (!res.ok) {
    throw new Error("Email delivery failed");
  }
}

function buildCodeEmailHtml(code: string): string {
  return `
    <div style="background-color:#0a0a0a;color:#ffffff;font-family:'Inter',Arial,sans-serif;padding:40px 20px;text-align:center;">
      <div style="max-width:560px;margin:0 auto;background:#141414;border-radius:24px;padding:40px;border:1px solid #2a2a2a;">
        <div style="font-family:'Playfair Display',Georgia,serif;font-size:44px;font-style:italic;font-weight:bold;margin-bottom:16px;">A</div>
        <h1 style="font-size:24px;font-weight:500;margin:0 0 12px 0;">Your verification code</h1>
        <p style="color:#a0a0a0;font-size:15px;margin:0 0 28px 0;">Use the code below to continue. It expires in 10 minutes.</p>
        <div style="display:inline-block;background:#ffffff;color:#000000;font-size:32px;font-weight:700;letter-spacing:10px;padding:16px 28px;border-radius:16px;font-variant-numeric:tabular-nums;">${code}</div>
        <p style="color:#666666;font-size:12px;margin-top:32px;">If you didn't request this code, you can safely ignore this email.</p>
        <div style="border-top:1px solid #2a2a2a;margin-top:24px;padding-top:20px;color:#555;font-size:11px;">
          Aether · The future of community chat
        </div>
      </div>
    </div>`;
}
