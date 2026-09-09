const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";

function getBrevoConfig() {
  const apiKey = process.env.BREVO_API_KEY?.trim();
  const senderEmail = process.env.BREVO_SENDER_EMAIL?.trim();
  const senderName = process.env.BREVO_SENDER_NAME?.trim() || "Task Manager";

  if (!apiKey || !senderEmail) {
    return null;
  }

  return { apiKey, senderEmail, senderName };
}

export function isMailConfigured() {
  return !!getBrevoConfig();
}

/**
 * @param {string} to
 * @param {string} otp
 */
export async function sendOtpEmail(to, otp) {
  const config = getBrevoConfig();

  if (!config) {
    if (process.env.NODE_ENV !== "production") {
      console.log(`[mail] Brevo not configured — OTP for ${to}: ${otp} (dev only, not sent)`);
      return { ok: true, devMode: true };
    }
    throw new Error("Email service is not configured on this server.");
  }

  const subject = "Your Task Manager verification code";
  const textContent = `Your verification code is ${otp}. It expires in 10 minutes.`;
  const htmlContent = `
      <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto">
        <h2 style="color:#0d6efd">Task Manager</h2>
        <p>Your email verification code is:</p>
        <p style="font-size:28px;font-weight:700;letter-spacing:6px">${otp}</p>
        <p style="color:#666">This code expires in <strong>10 minutes</strong>.</p>
        <p style="color:#999;font-size:12px">If you did not request this, you can ignore this email.</p>
      </div>
    `;

  const res = await fetch(BREVO_API_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "api-key": config.apiKey,
    },
    body: JSON.stringify({
      sender: { name: config.senderName, email: config.senderEmail },
      to: [{ email: to }],
      subject,
      htmlContent,
      textContent,
    }),
  });

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const errBody = await res.json();
      detail = errBody?.message || errBody?.error || JSON.stringify(errBody);
    } catch {
      /* ignore */
    }
    console.error("[mail/brevo]", res.status, detail);
    throw new Error("Failed to send verification email. Please try again later.");
  }

  return { ok: true, devMode: false };
}

/**
 * @param {string} to
 * @param {string} otp
 */
export async function sendPasswordResetEmail(to, otp) {
  const config = getBrevoConfig();

  if (!config) {
    if (process.env.NODE_ENV !== "production") {
      console.log(`[mail] Brevo not configured — password reset OTP for ${to}: ${otp} (dev only, not sent)`);
      return { ok: true, devMode: true };
    }
    throw new Error("Email service is not configured on this server.");
  }

  const subject = "Reset your Task Manager password";
  const textContent = `Your password reset code is ${otp}. It expires in 10 minutes.`;
  const htmlContent = `
      <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto">
        <h2 style="color:#0d6efd">Task Manager</h2>
        <p>Use this code to reset your password:</p>
        <p style="font-size:28px;font-weight:700;letter-spacing:6px">${otp}</p>
        <p style="color:#666">This code expires in <strong>10 minutes</strong>.</p>
        <p style="color:#999;font-size:12px">If you did not request a password reset, you can ignore this email.</p>
      </div>
    `;

  const res = await fetch(BREVO_API_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "api-key": config.apiKey,
    },
    body: JSON.stringify({
      sender: { name: config.senderName, email: config.senderEmail },
      to: [{ email: to }],
      subject,
      htmlContent,
      textContent,
    }),
  });

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const errBody = await res.json();
      detail = errBody?.message || errBody?.error || JSON.stringify(errBody);
    } catch {
      /* ignore */
    }
    console.error("[mail/brevo] password reset", res.status, detail);
    throw new Error("Failed to send reset email. Please try again later.");
  }

  return { ok: true, devMode: false };
}

/**
 * Notify an admin that an employee requested a password reset (same OTP email + employee name).
 * @param {string} to Admin email
 * @param {{ employeeName: string; employeeEmail: string; otp: string }} params
 */
export async function sendPasswordResetAdminNotifyEmail(to, { employeeName, employeeEmail, otp }) {
  const config = getBrevoConfig();
  const safeName = employeeName?.trim() || employeeEmail || "An employee";
  const safeEmail = employeeEmail?.trim() || "";

  if (!config) {
    if (process.env.NODE_ENV !== "production") {
      console.log(
        `[mail] Brevo not configured — password reset admin notify for ${to}: ${safeName} <${safeEmail}> OTP ${otp} (dev only, not sent)`
      );
      return { ok: true, devMode: true };
    }
    return { ok: false, skipped: true };
  }

  const subject = `Password reset requested — ${safeName}`;
  const textContent = [
    `${safeName}${safeEmail ? ` (${safeEmail})` : ""} requested a password reset.`,
    "",
    `Password reset code: ${otp}`,
    "This code expires in 10 minutes.",
    "",
    "The employee also received this code by email.",
  ].join("\n");
  const htmlContent = `
      <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto">
        <h2 style="color:#0d6efd">Task Manager</h2>
        <p style="margin-bottom:0.5rem">
          <strong>${escapeHtml(safeName)}</strong>${safeEmail ? ` (<a href="mailto:${escapeHtml(safeEmail)}" style="color:#0d6efd">${escapeHtml(safeEmail)}</a>)` : ""}
          requested a password reset.
        </p>
        <p>Use this code to reset their password:</p>
        <p style="font-size:28px;font-weight:700;letter-spacing:6px">${escapeHtml(otp)}</p>
        <p style="color:#666">This code expires in <strong>10 minutes</strong>.</p>
        <p style="color:#999;font-size:12px">The employee also received this code. If this was unexpected, contact them or your team.</p>
      </div>
    `;

  const res = await fetch(BREVO_API_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "api-key": config.apiKey,
    },
    body: JSON.stringify({
      sender: { name: config.senderName, email: config.senderEmail },
      to: [{ email: to }],
      subject,
      htmlContent,
      textContent,
    }),
  });

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const errBody = await res.json();
      detail = errBody?.message || errBody?.error || JSON.stringify(errBody);
    } catch {
      /* ignore */
    }
    console.error("[mail/brevo] password reset admin notify", res.status, detail);
    return { ok: false };
  }

  return { ok: true, devMode: false };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * @param {{
 *   to: string;
 *   recipientName: string;
 *   admin: { email: string; displayName: string };
 * }} params
 */
export async function sendAdminPromotionEmail(params) {
  const config = getBrevoConfig();
  const adminName = params.admin.displayName?.trim() || "An administrator";
  const adminEmail = params.admin.email?.trim() || "";
  const recipientName = params.recipientName?.trim() || "there";
  const signInUrl = process.env.APP_PUBLIC_URL?.trim() || "";

  if (!config) {
    if (process.env.NODE_ENV !== "production") {
      console.log(
        `[mail] Brevo not configured — admin promotion email for ${params.to} (by ${adminEmail}) (dev only, not sent)`
      );
      return { ok: true, devMode: true };
    }
    throw new Error("Email service is not configured on this server.");
  }

  const subject = "You've been granted admin access — Task Manager";
  const textContent = [
    `Hi ${recipientName},`,
    "",
    `${adminName} (${adminEmail}) has granted you admin access to Task Manager.`,
    "",
    "You can now sign in on the website to manage lists, assign tasks, review submissions, and promote other team members.",
    signInUrl ? `Sign in: ${signInUrl}` : null,
    "",
    "If you have questions, reply to this email to contact your administrator.",
    "",
    "— Task Manager",
  ]
    .filter(Boolean)
    .join("\n");

  const htmlContent = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:520px;margin:0 auto;color:#212529;line-height:1.5">
      <div style="background:#0d6efd;color:#fff;border-radius:10px 10px 0 0;padding:20px 24px">
        <h1 style="margin:0;font-size:20px;font-weight:700">Task Manager</h1>
        <p style="margin:8px 0 0;opacity:0.92;font-size:14px">Admin access granted</p>
      </div>
      <div style="border:1px solid #dee2e6;border-top:0;border-radius:0 0 10px 10px;padding:24px;background:#fff">
        <p style="margin:0 0 16px">Hi <strong>${escapeHtml(recipientName)}</strong>,</p>
        <p style="margin:0 0 16px">
          <strong>${escapeHtml(adminName)}</strong>
          (<a href="mailto:${escapeHtml(adminEmail)}" style="color:#0d6efd">${escapeHtml(adminEmail)}</a>)
          has granted you <strong>admin access</strong> to Task Manager.
        </p>
        <p style="margin:0 0 16px">You can now sign in on the website to:</p>
        <ul style="margin:0 0 20px;padding-left:20px">
          <li>Manage task lists</li>
          <li>Assign tasks to employees</li>
          <li>Review submissions and proof photos</li>
          <li>Grant admin access to other team members</li>
        </ul>
        ${
          signInUrl
            ? `<p style="margin:0 0 20px"><a href="${escapeHtml(signInUrl)}" style="display:inline-block;background:#0d6efd;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600">Open Task Manager</a></p>`
            : ""
        }
        <p style="margin:0;font-size:13px;color:#6c757d">
          If you have questions, reply to this email to contact ${escapeHtml(adminName)}.
        </p>
      </div>
      <p style="margin:16px 0 0;font-size:12px;color:#adb5bd;text-align:center">
        Sent on behalf of ${escapeHtml(adminName)} via Task Manager
      </p>
    </div>
  `;

  const res = await fetch(BREVO_API_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "api-key": config.apiKey,
    },
    body: JSON.stringify({
      sender: { name: adminName, email: config.senderEmail },
      to: [{ email: params.to, name: recipientName }],
      replyTo: adminEmail ? { email: adminEmail, name: adminName } : undefined,
      subject,
      htmlContent,
      textContent,
    }),
  });

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const errBody = await res.json();
      detail = errBody?.message || errBody?.error || JSON.stringify(errBody);
    } catch {
      /* ignore */
    }
    console.error("[mail/brevo] admin promotion", res.status, detail);
    throw new Error("Failed to send admin promotion email.");
  }

  return { ok: true, devMode: false };
}

/**
 * @param {{
 *   to: string;
 *   recipientName: string;
 *   admin: { email: string; displayName: string };
 * }} params
 */
export async function sendAdminRevocationEmail(params) {
  const config = getBrevoConfig();
  const adminName = params.admin.displayName?.trim() || "An administrator";
  const adminEmail = params.admin.email?.trim() || "";
  const recipientName = params.recipientName?.trim() || "there";

  if (!config) {
    if (process.env.NODE_ENV !== "production") {
      console.log(
        `[mail] Brevo not configured — admin revocation email for ${params.to} (by ${adminEmail}) (dev only, not sent)`
      );
      return { ok: true, devMode: true };
    }
    throw new Error("Email service is not configured on this server.");
  }

  const subject = "Your admin access has been revoked — Task Manager";
  const textContent = [
    `Hi ${recipientName},`,
    "",
    `${adminName} (${adminEmail}) has revoked your admin access to Task Manager.`,
    "",
    "You no longer have access to the admin dashboard on the website. You can still sign in as an employee and use the Kalpanik Reminder mobile app for assigned tasks.",
    "",
    "If you believe this was a mistake, reply to this email to contact your administrator.",
    "",
    "— Task Manager",
  ].join("\n");

  const htmlContent = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:520px;margin:0 auto;color:#212529;line-height:1.5">
      <div style="background:#dc3545;color:#fff;border-radius:10px 10px 0 0;padding:20px 24px">
        <h1 style="margin:0;font-size:20px;font-weight:700">Task Manager</h1>
        <p style="margin:8px 0 0;opacity:0.92;font-size:14px">Admin access revoked</p>
      </div>
      <div style="border:1px solid #dee2e6;border-top:0;border-radius:0 0 10px 10px;padding:24px;background:#fff">
        <p style="margin:0 0 16px">Hi <strong>${escapeHtml(recipientName)}</strong>,</p>
        <p style="margin:0 0 16px">
          <strong>${escapeHtml(adminName)}</strong>
          (<a href="mailto:${escapeHtml(adminEmail)}" style="color:#0d6efd">${escapeHtml(adminEmail)}</a>)
          has revoked your <strong>admin access</strong> to Task Manager.
        </p>
        <p style="margin:0 0 16px">What this means:</p>
        <ul style="margin:0 0 20px;padding-left:20px">
          <li>You can no longer use the admin dashboard on the website</li>
          <li>You can still sign in as an <strong>employee</strong></li>
          <li>Assigned tasks remain available in the <strong>Kalpanik Reminder</strong> mobile app</li>
        </ul>
        <p style="margin:0;font-size:13px;color:#6c757d">
          If you believe this was a mistake, reply to this email to contact ${escapeHtml(adminName)}.
        </p>
      </div>
      <p style="margin:16px 0 0;font-size:12px;color:#adb5bd;text-align:center">
        Sent on behalf of ${escapeHtml(adminName)} via Task Manager
      </p>
    </div>
  `;

  const res = await fetch(BREVO_API_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "api-key": config.apiKey,
    },
    body: JSON.stringify({
      sender: { name: adminName, email: config.senderEmail },
      to: [{ email: params.to, name: recipientName }],
      replyTo: adminEmail ? { email: adminEmail, name: adminName } : undefined,
      subject,
      htmlContent,
      textContent,
    }),
  });

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const errBody = await res.json();
      detail = errBody?.message || errBody?.error || JSON.stringify(errBody);
    } catch {
      /* ignore */
    }
    console.error("[mail/brevo] admin revocation", res.status, detail);
    throw new Error("Failed to send admin revocation email.");
  }

  return { ok: true, devMode: false };
}

function previewSubjectTitle(title) {
  const t = String(title || "").trim() || "Task";
  return t.length > 80 ? `${t.slice(0, 77)}…` : t;
}

function formatTaskDueLine(dueAt, allDay) {
  if (!dueAt) return null;
  const d = dueAt instanceof Date ? dueAt : new Date(dueAt);
  if (Number.isNaN(d.getTime())) return null;
  try {
    if (allDay) {
      return d.toLocaleDateString("en-IN", {
        weekday: "short",
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    }
    return d.toLocaleString("en-IN", {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return d.toISOString();
  }
}

function truncateNotes(notes) {
  const t = String(notes || "").trim();
  if (!t) return "";
  return t.length > 400 ? `${t.slice(0, 397)}…` : t;
}

/**
 * @param {{
 *   kind: "assigned" | "updated";
 *   to: string;
 *   recipientName: string;
 *   admin: { email?: string; displayName?: string };
 *   task: { title?: string; notes?: string; dueAt?: Date | string | null; allDay?: boolean };
 * }} params
 */
async function sendTaskNoticeEmail(params) {
  const config = getBrevoConfig();
  const adminName = params.admin.displayName?.trim() || "An administrator";
  const adminEmail = params.admin.email?.trim() || "";
  const recipientName = params.recipientName?.trim() || "there";
  const signInUrl = process.env.APP_PUBLIC_URL?.trim() || "";
  const title = String(params.task.title || "").trim() || "Untitled task";
  const dueLine = formatTaskDueLine(params.task.dueAt, params.task.allDay);
  const notes = truncateNotes(params.task.notes);
  const assigned = params.kind === "assigned";

  if (!config) {
    if (process.env.NODE_ENV !== "production") {
      console.log(
        `[mail] Brevo not configured — task ${params.kind} email for ${params.to} (“${title}”) (dev only, not sent)`
      );
      return { ok: true, devMode: true };
    }
    console.warn(`[mail] Brevo not configured — skipped task ${params.kind} email for ${params.to}`);
    return { ok: false, skipped: true };
  }

  const subject = assigned
    ? `New task assigned: ${previewSubjectTitle(title)}`
    : `Task updated: ${previewSubjectTitle(title)}`;
  const intro = assigned
    ? `${adminName} assigned you a task in Task Manager.`
    : `${adminName} updated a task assigned to you.`;
  const headerSub = assigned ? "New task assigned" : "Task updated";

  const textContent = [
    `Hi ${recipientName},`,
    "",
    intro,
    "",
    `Task: ${title}`,
    dueLine ? `Due: ${dueLine}` : null,
    notes ? `Notes: ${notes}` : null,
    signInUrl ? `Open Task Manager: ${signInUrl}` : null,
    "",
    "If you have questions, reply to this email to contact your administrator.",
    "",
    "— Task Manager",
  ]
    .filter((line) => line !== null)
    .join("\n");

  const htmlContent = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:520px;margin:0 auto;color:#212529;line-height:1.5">
      <div style="background:#00535b;color:#fff;border-radius:10px 10px 0 0;padding:20px 24px">
        <h1 style="margin:0;font-size:20px;font-weight:700">Task Manager</h1>
        <p style="margin:8px 0 0;opacity:0.92;font-size:14px">${escapeHtml(headerSub)}</p>
      </div>
      <div style="border:1px solid #dee2e6;border-top:0;border-radius:0 0 10px 10px;padding:24px;background:#fff">
        <p style="margin:0 0 16px">Hi <strong>${escapeHtml(recipientName)}</strong>,</p>
        <p style="margin:0 0 16px">
          <strong>${escapeHtml(adminName)}</strong>${
            adminEmail
              ? ` (<a href="mailto:${escapeHtml(adminEmail)}" style="color:#00535b">${escapeHtml(adminEmail)}</a>)`
              : ""
          }
          ${assigned ? "assigned you a task." : "updated a task assigned to you."}
        </p>
        <p style="margin:0 0 8px;font-size:16px;font-weight:700">${escapeHtml(title)}</p>
        ${
          dueLine
            ? `<p style="margin:0 0 12px;font-size:14px;color:#495057">Due: ${escapeHtml(dueLine)}</p>`
            : ""
        }
        ${
          notes
            ? `<p style="margin:0 0 16px;font-size:14px;color:#495057;white-space:pre-wrap">${escapeHtml(notes)}</p>`
            : ""
        }
        ${
          signInUrl
            ? `<p style="margin:16px 0 20px"><a href="${escapeHtml(signInUrl)}" style="display:inline-block;background:#00535b;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600">Open Task Manager</a></p>`
            : ""
        }
        <p style="margin:0;font-size:13px;color:#6c757d">
          If you have questions, reply to this email to contact ${escapeHtml(adminName)}.
        </p>
      </div>
      <p style="margin:16px 0 0;font-size:12px;color:#adb5bd;text-align:center">
        Sent on behalf of ${escapeHtml(adminName)} via Task Manager
      </p>
    </div>
  `;

  const res = await fetch(BREVO_API_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "api-key": config.apiKey,
    },
    body: JSON.stringify({
      sender: { name: adminName, email: config.senderEmail },
      to: [{ email: params.to, name: recipientName }],
      replyTo: adminEmail ? { email: adminEmail, name: adminName } : undefined,
      subject,
      htmlContent,
      textContent,
    }),
  });

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const errBody = await res.json();
      detail = errBody?.message || errBody?.error || JSON.stringify(errBody);
    } catch {
      /* ignore */
    }
    console.error(`[mail/brevo] task ${params.kind}`, res.status, detail);
    throw new Error("Failed to send task notification email.");
  }

  return { ok: true, devMode: false };
}

/**
 * @param {{
 *   to: string;
 *   recipientName: string;
 *   admin: { email?: string; displayName?: string };
 *   task: { title?: string; notes?: string; dueAt?: Date | string | null; allDay?: boolean };
 * }} params
 */
export async function sendTaskAssignedEmail(params) {
  return sendTaskNoticeEmail({ ...params, kind: "assigned" });
}

/**
 * @param {{
 *   to: string;
 *   recipientName: string;
 *   admin: { email?: string; displayName?: string };
 *   task: { title?: string; notes?: string; dueAt?: Date | string | null; allDay?: boolean };
 * }} params
 */
export async function sendTaskUpdatedEmail(params) {
  return sendTaskNoticeEmail({ ...params, kind: "updated" });
}

/**
 * @param {{
 *   to: string;
 *   recipientName: string;
 *   admin: { email?: string; displayName?: string };
 *   previousName: string;
 *   titles: string[];
 * }} params
 */
export async function sendWorkTransferredEmail(params) {
  const config = getBrevoConfig();
  const adminName = params.admin.displayName?.trim() || "An administrator";
  const adminEmail = params.admin.email?.trim() || "";
  const recipientName = params.recipientName?.trim() || "there";
  const previousName = params.previousName?.trim() || "a teammate";
  const signInUrl = process.env.APP_PUBLIC_URL?.trim() || "";
  const titles = (params.titles ?? []).map((t) => String(t || "").trim()).filter(Boolean);
  const shown = titles.slice(0, 20);
  const extra = titles.length > shown.length ? titles.length - shown.length : 0;

  if (!config) {
    if (process.env.NODE_ENV !== "production") {
      console.log(
        `[mail] Brevo not configured — work transfer email for ${params.to} (${titles.length} tasks) (dev only, not sent)`
      );
      return { ok: true, devMode: true };
    }
    console.warn(`[mail] Brevo not configured — skipped work transfer email for ${params.to}`);
    return { ok: false, skipped: true };
  }

  const subject = titles.length === 1
    ? `Task assigned: ${previewSubjectTitle(shown[0])}`
    : `${titles.length} tasks assigned to you — Task Manager`;
  const listText = shown.map((t) => `- ${t}`).join("\n");
  const extraText = extra ? `\n…and ${extra} more.` : "";

  const textContent = [
    `Hi ${recipientName},`,
    "",
    `${adminName} assigned you work previously assigned to ${previousName}.`,
    "",
    titles.length ? `Tasks:\n${listText}${extraText}` : null,
    signInUrl ? `Open Task Manager: ${signInUrl}` : null,
    "",
    "If you have questions, reply to this email to contact your administrator.",
    "",
    "— Task Manager",
  ]
    .filter((line) => line !== null)
    .join("\n");

  const listHtml = shown
    .map((t) => `<li style="margin:0 0 6px">${escapeHtml(t)}</li>`)
    .join("");
  const extraHtml = extra
    ? `<p style="margin:8px 0 0;font-size:13px;color:#6c757d">…and ${extra} more.</p>`
    : "";

  const htmlContent = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:520px;margin:0 auto;color:#212529;line-height:1.5">
      <div style="background:#00535b;color:#fff;border-radius:10px 10px 0 0;padding:20px 24px">
        <h1 style="margin:0;font-size:20px;font-weight:700">Task Manager</h1>
        <p style="margin:8px 0 0;opacity:0.92;font-size:14px">Work transferred to you</p>
      </div>
      <div style="border:1px solid #dee2e6;border-top:0;border-radius:0 0 10px 10px;padding:24px;background:#fff">
        <p style="margin:0 0 16px">Hi <strong>${escapeHtml(recipientName)}</strong>,</p>
        <p style="margin:0 0 16px">
          <strong>${escapeHtml(adminName)}</strong> assigned you work previously assigned to
          <strong>${escapeHtml(previousName)}</strong>.
        </p>
        ${
          listHtml
            ? `<ul style="margin:0 0 16px;padding-left:20px">${listHtml}</ul>${extraHtml}`
            : ""
        }
        ${
          signInUrl
            ? `<p style="margin:16px 0 20px"><a href="${escapeHtml(signInUrl)}" style="display:inline-block;background:#00535b;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600">Open Task Manager</a></p>`
            : ""
        }
        <p style="margin:0;font-size:13px;color:#6c757d">
          If you have questions, reply to this email to contact ${escapeHtml(adminName)}.
        </p>
      </div>
      <p style="margin:16px 0 0;font-size:12px;color:#adb5bd;text-align:center">
        Sent on behalf of ${escapeHtml(adminName)} via Task Manager
      </p>
    </div>
  `;

  const res = await fetch(BREVO_API_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "api-key": config.apiKey,
    },
    body: JSON.stringify({
      sender: { name: adminName, email: config.senderEmail },
      to: [{ email: params.to, name: recipientName }],
      replyTo: adminEmail ? { email: adminEmail, name: adminName } : undefined,
      subject,
      htmlContent,
      textContent,
    }),
  });

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const errBody = await res.json();
      detail = errBody?.message || errBody?.error || JSON.stringify(errBody);
    } catch {
      /* ignore */
    }
    console.error("[mail/brevo] work transfer", res.status, detail);
    throw new Error("Failed to send work transfer email.");
  }

  return { ok: true, devMode: false };
}
