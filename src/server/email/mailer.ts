import "server-only";
import { getConfig } from "@/server/config/env";
import { log } from "@/server/log";
import { AppError } from "@/server/http/errors";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Email delivery. `resend` uses the Resend REST API; `console` is for local
 * development only (production config validation rejects it) and prints the
 * message to the server log so verification links can be followed locally.
 */
export async function sendEmail(message: EmailMessage): Promise<void> {
  const config = getConfig();
  if (config.EMAIL_PROVIDER === "console") {
    // Intentionally prints the body: this mode only exists for local development.
    console.log(
      `\n──── [dev email] to=${message.to} subject="${message.subject}"\n${message.text}\n────\n`,
    );
    return;
  }
  if (!config.RESEND_API_KEY) {
    throw new AppError("provider_unavailable", "Email delivery is not configured.");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.RESEND_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: config.EMAIL_FROM,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      log.error("email.send_failed", { status: res.status });
      throw new AppError("provider_error", "We could not send the email. Please try again later.");
    }
  } finally {
    clearTimeout(timer);
  }
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function layout(title: string, body: string, actionLabel: string, actionUrl: string): string {
  return `<!doctype html><html><body style="font-family:Georgia,serif;background:#f7f5f0;padding:24px;color:#1b2540">
<div style="max-width:520px;margin:auto;background:#fff;border:1px solid #e3ded3;border-radius:8px;padding:28px">
<h1 style="font-size:22px;margin:0 0 12px">${escapeHtml(title)}</h1>
<p style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5">${body}</p>
<p><a href="${escapeHtml(actionUrl)}" style="display:inline-block;background:#1d2d50;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-family:Arial,sans-serif">${escapeHtml(actionLabel)}</a></p>
<p style="font-family:Arial,sans-serif;font-size:12px;color:#5b6475">If you did not request this, you can ignore this email.</p>
</div></body></html>`;
}

export function verificationEmail(to: string, name: string, url: string): EmailMessage {
  return {
    to,
    subject: "Confirm your BritSpeak AI email address",
    text: `Hello ${name},\n\nPlease confirm your email address by opening this link (valid for 24 hours):\n${url}\n\nIf you did not create an account, you can ignore this email.`,
    html: layout(
      "Confirm your email",
      `Hello ${escapeHtml(name)}, please confirm your email address. The link is valid for 24 hours.`,
      "Confirm email",
      url,
    ),
  };
}

export function passwordResetEmail(to: string, url: string): EmailMessage {
  return {
    to,
    subject: "Reset your BritSpeak AI password",
    text: `Someone asked to reset the password for this account.\nOpen this link within 1 hour to choose a new password:\n${url}\n\nIf this was not you, no action is needed.`,
    html: layout(
      "Reset your password",
      "Someone asked to reset the password for this account. The link is valid for 1 hour.",
      "Choose a new password",
      url,
    ),
  };
}
