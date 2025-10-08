// backend/utils/email.js
// Minimal, robust email helper: prefer SendGrid (API) on Render, fallback to SMTP via nodemailer.

const nodemailer = require("nodemailer");

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || "";
const FROM_ADDRESS =
  process.env.SMTP_USER || process.env.EMAIL_USER || "no-reply@px39.example";

// Small minimal HTML template (name + link/token only)
function simpleTemplate({ title, bodyHtml }) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${title}</title>
  </head>
  <body>
    <div>
      ${bodyHtml}
    </div>
  </body>
</html>`;
}

/* ---------------- SendGrid (preferred on Render) ---------------- */
async function sendViaSendGrid({ from, to, subject, html }) {
  if (!SENDGRID_API_KEY) throw new Error("SENDGRID_API_KEY not configured");
  const body = {
    personalizations: [
      {
        to: Array.isArray(to) ? to.map((t) => ({ email: t })) : [{ email: to }],
        subject,
      },
    ],
    from: { email: from || FROM_ADDRESS },
    content: [{ type: "text/html", value: html }],
  };

  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SENDGRID_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    const err = new Error(
      `SendGrid send failed: ${res.status} ${res.statusText} ${txt}`
    );
    err.status = res.status;
    throw err;
  }
  return { ok: true, provider: "sendgrid" };
}

/* ---------------- Nodemailer SMTP fallback ---------------- */
function createSmtpTransporter() {
  const user = process.env.SMTP_USER || process.env.EMAIL_USER;
  const pass = process.env.SMTP_PASS || process.env.EMAIL_PASS;
  if (!user || !pass) return null;

  const host = process.env.SMTP_HOST || "smtp.gmail.com";
  const port = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587;
  const secure = process.env.SMTP_SECURE === "true" || port === 465;

  const cfg = {
    host,
    port,
    secure,
    auth: { user, pass },
    // longer timeouts so cloud environments have some slack
    connectionTimeout: Number(process.env.SMTP_CONN_TIMEOUT || 20000),
    greetingTimeout: Number(process.env.SMTP_GREETING_TIMEOUT || 20000),
    socketTimeout: Number(process.env.SMTP_SOCKET_TIMEOUT || 30000),
    tls: {
      // allow disabling verification in some environments (not recommended)
      rejectUnauthorized:
        process.env.SMTP_TLS_REJECT === "false" ? false : true,
    },
  };
  return nodemailer.createTransport(cfg);
}

const smtpTransporter = createSmtpTransporter();
let smtpVerified = false;

// verify SMTP if configured, but don't throw — just log
async function verifySmtpIfPresent() {
  if (!smtpTransporter) {
    smtpVerified = false;
    console.warn("[email] smtp transporter not configured (no SMTP creds)");
    return;
  }
  try {
    await smtpTransporter.verify();
    smtpVerified = true;
    console.log("[email] SMTP transporter verified");
  } catch (err) {
    smtpVerified = false;
    console.warn(
      "[email] SMTP verify failed (will fall back to SendGrid if configured):",
      err && err.message ? err.message : err
    );
  }
}
void verifySmtpIfPresent(); // fire-and-forget

/* ---------------- unified send wrapper ---------------- */
async function sendMail({ from, to, subject, html }) {
  // prefer SendGrid (recommended for Render)
  if (SENDGRID_API_KEY) {
    try {
      return await sendViaSendGrid({ from, to, subject, html });
    } catch (err) {
      console.error(
        "[email] SendGrid send failed:",
        err && err.message ? err.message : err
      );
      // if SendGrid fails, attempt SMTP as a last resort
    }
  }

  // fallback to SMTP if available
  if (smtpTransporter) {
    try {
      const info = await smtpTransporter.sendMail({
        from: from || FROM_ADDRESS,
        to,
        subject,
        html,
      });
      console.log(
        `[email] sent via SMTP to ${to} messageId=${
          info.messageId || info.response || "unknown"
        }`
      );
      return { ok: true, provider: "smtp", info };
    } catch (err) {
      console.error(
        "[email] SMTP send failed:",
        err && err.message ? err.message : err
      );
      throw err;
    }
  }

  // nothing available
  const msg =
    "[email] No provider available (SENDGRID_API_KEY not set, SMTP not configured)";
  console.warn(msg);
  throw new Error(msg);
}

/* ---------------- exported helpers (minimal templates) ---------------- */

async function sendVerificationEmail(to, token, name) {
  const verifyUrl = `${
    process.env.FRONTEND_URL || process.env.BACKEND_URL || ""
  }/auth/verify?token=${token}`;
  const bodyHtml = `<p>Hi ${name || ""},</p>
    <p>Please verify your account by clicking the link below:</p>
    <p><a href="${verifyUrl}">${verifyUrl}</a></p>
    <p>This link expires in 24 hours.</p>`;
  const html = simpleTemplate({ title: "Verify your PX39 account", bodyHtml });
  return sendMail({
    from: FROM_ADDRESS,
    to,
    subject: "Verify your PX39 account",
    html,
  });
}

async function sendResetPasswordEmail(to, token, name) {
  const resetUrl = `${
    process.env.FRONTEND_URL || process.env.BACKEND_URL || ""
  }/auth/reset-password?token=${token}`;
  const bodyHtml = `<p>Hi ${name || ""},</p>
    <p>Reset your password using the link below:</p>
    <p><a href="${resetUrl}">${resetUrl}</a></p>
    <p>This link is valid for 1 hour.</p>`;
  const html = simpleTemplate({ title: "Reset your PX39 password", bodyHtml });
  return sendMail({
    from: FROM_ADDRESS,
    to,
    subject: "Reset your PX39 password",
    html,
  });
}

async function sendMagicLinkEmail(to, token, name) {
  const magicUrl = `${process.env.BACKEND_URL || ""}/auth/magic?token=${token}`;
  const bodyHtml = `<p>Hi ${name || ""},</p>
    <p>Use the link below to sign in (expires in 15 minutes):</p>
    <p><a href="${magicUrl}">${magicUrl}</a></p>`;
  const html = simpleTemplate({ title: "Your PX39 login link", bodyHtml });
  return sendMail({
    from: FROM_ADDRESS,
    to,
    subject: "Your PX39 login link",
    html,
  });
}

async function sendInboundContactEmail({ name, email, phone = "", message }) {
  const adminTo = process.env.ADMIN_EMAIL || FROM_ADDRESS;
  const bodyHtml = `<p>New contact from ${name} &lt;${email}&gt;</p>
    <p>Phone: ${phone}</p>
    <p>Message:</p>
    <div>${(String(message) || "").replace(/\n/g, "<br/>")}</div>`;
  const html = simpleTemplate({ title: "New contact message", bodyHtml });
  return sendMail({
    from: FROM_ADDRESS,
    to: adminTo,
    subject: `New contact from ${name}`,
    html,
  });
}

async function sendContactAutoReply({ to, name, message }) {
  const bodyHtml = `<p>Hi ${name || ""},</p>
    <p>${
      (message && String(message).replace(/\n/g, "<br/>")) ||
      "Thanks — we got your message."
    }</p>`;
  const html = simpleTemplate({ title: "PX39 — reply", bodyHtml });
  return sendMail({
    from: FROM_ADDRESS,
    to,
    subject: "Thanks — message received",
    html,
  });
}

module.exports = {
  sendVerificationEmail,
  sendResetPasswordEmail,
  sendMagicLinkEmail,
  sendInboundContactEmail,
  sendContactAutoReply,
  // debugging
  _internal: {
    smtpVerified: () => smtpVerified,
    hasSendGrid: !!SENDGRID_API_KEY,
  },
};
