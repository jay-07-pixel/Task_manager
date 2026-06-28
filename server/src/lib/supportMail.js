import nodemailer from "nodemailer";

function getSupportSmtpConfig() {
  const user = process.env.SUPPORT_SMTP_USER?.trim();
  const pass = process.env.SUPPORT_SMTP_PASSWORD?.replace(/\s+/g, "").trim();
  const to = process.env.SUPPORT_SMTP_TO?.trim() || "support@kalpanik.in";

  if (!user || !pass) {
    return null;
  }

  return { user, pass, to };
}

export function isSupportMailConfigured() {
  return !!getSupportSmtpConfig();
}

/**
 * @param {{
 *   subject: string;
 *   message: string;
 *   appVersion: string;
 *   appVersionCode: string;
 *   user: { email: string; displayName: string | null };
 * }} params
 */
export async function sendSupportContactEmail(params) {
  const config = getSupportSmtpConfig();
  if (!config) {
    throw new Error("Support email is not configured on the server.");
  }

  const appLabel =
    params.appVersion === "web" || params.appVersionCode === "web"
      ? "Kalpanik Task Manager (web)"
      : "Kalpanik Reminder";

  const body = [
    params.message,
    "",
    "---",
    `App: ${appLabel}`,
    params.appVersion && params.appVersion !== "web"
      ? `Version: ${params.appVersion}${params.appVersionCode ? ` (${params.appVersionCode})` : ""}`
      : null,
    params.user.displayName ? `User: ${params.user.displayName}` : null,
    params.user.email ? `Signed in as: ${params.user.email}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const transport = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: {
      user: config.user,
      pass: config.pass,
    },
  });

  await transport.sendMail({
    from: config.user,
    to: config.to,
    replyTo: params.user.email || undefined,
    subject: `[Kalpanik Support] ${params.subject}`,
    text: body,
  });

  return { ok: true };
}
