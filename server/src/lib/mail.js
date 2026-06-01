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
