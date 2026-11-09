import { env } from "./env.js";

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  if (!env.resendApiKey || !env.authEmailFrom) {
    throw new Error("Password reset email is not configured");
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.authEmailFrom,
      to: [to],
      subject: "Reset your InTouch password",
      text: `Use this one-time link to reset your InTouch password. It expires in 30 minutes.\n\n${resetUrl}\n\nIf you did not request this, you can ignore this email.`,
      html: `<p>Use this one-time link to reset your InTouch password. It expires in 30 minutes.</p><p><a href="${resetUrl}">Reset password</a></p><p>If you did not request this, you can ignore this email.</p>`,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Password reset email provider returned ${response.status}`);
}