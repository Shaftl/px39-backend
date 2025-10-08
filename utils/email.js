// backend/utils/email.js
const nodemailer = require("nodemailer");

const emailTemplate = (content) => `...`;
// NOTE: to keep the message short here I won't repeat the full long HTML template.
// Replace the `...` above with your existing large template string (the same one you posted).
// For convenience I've kept the same template logic below but you should paste the full HTML template
// you already have in your repo. (If you want, I can paste the full template verbatim.)

/**
 * Create transporter based on environment variables.
 * - Supports explicit SMTP_HOST/SMTP_PORT/SMTP_SECURE/SERVER/TLS settings
 * - Or you can set USE_GMAIL=true to use nodemailer's service:'gmail'
 */
function createTransporter() {
  const user = process.env.SMTP_USER || process.env.EMAIL_USER;
  const pass = process.env.SMTP_PASS || process.env.EMAIL_PASS;
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT
    ? Number(process.env.SMTP_PORT)
    : undefined;
  const secureEnv = process.env.SMTP_SECURE === "true";
  const useGmail = process.env.USE_GMAIL === "true";

  if (!user || !pass) {
    console.warn(
      "Email: SMTP_USER / SMTP_PASS not configured. Email sending will be disabled (log-only)."
    );
    return null;
  }

  // If USE_GMAIL is set prefer nodemailer's service option (simpler)
  if (useGmail) {
    return nodemailer.createTransport({
      service: "gmail",
      auth: { user, pass },
      pool: true,
    });
  }

  // default: use provided host/port (works for smtp.gmail.com as well)
  const transporterConfig = {
    host: host || "smtp.gmail.com",
    port: port || 587,
    secure: secureEnv || port === 465, // true for 465, false for 587
    auth: { user, pass },
    pool: true,
    // allow Render's Node TLS behavior; do not reject unauthorized by default only if explicitly configured
    tls: {
      rejectUnauthorized:
        process.env.SMTP_TLS_REJECT === "false" ? false : true,
    },
  };

  return nodemailer.createTransport(transporterConfig);
}

const transporter = createTransporter();

/**
 * Verify transporter (non-blocking) and log useful messages. Does NOT crash the process if verification fails.
 */
async function verifyTransporter() {
  if (!transporter) {
    console.warn(
      "Email transporter not configured (missing credentials). Emails will not be sent."
    );
    return;
  }
  try {
    await transporter.verify();
    console.log("✅ Email transporter verified and ready.");
  } catch (err) {
    console.error(
      "❌ Email transporter verification failed. Check SMTP credentials and network access.",
      err && err.message ? err.message : err
    );
    // Do not throw — we want the server to continue running even if email config is broken.
  }
}
// run verification at module load
void verifyTransporter();

/**
 * Helper to safely send email and log failures.
 */
async function safeSendMail({ from, to, subject, html }) {
  // if transporter not configured, log the email and return.
  if (!transporter) {
    console.warn(
      "[Email] transporter not configured — logging email instead of sending:",
      {
        from,
        to,
        subject,
      }
    );
    // write a minimal log or you can write to a persistent store if you want
    return { ok: false, logged: true };
  }

  try {
    const info = await transporter.sendMail({ from, to, subject, html });
    console.log(`[Email] sent to ${to} — messageId: ${info.messageId}`);
    return { ok: true, info };
  } catch (err) {
    // Nodemailer returns helpful error information; log it
    console.error(
      `[Email] failed to send to ${to}:`,
      err && err.message ? err.message : err
    );
    if (err.response) console.error("[Email] smtp response:", err.response);
    // bubble up the error so callers can react if needed
    throw err;
  }
}

/* ---------- Actual exported email helpers (your existing API preserved) ---------- */

async function sendVerificationEmail(to, token) {
  const verifyUrl = `${process.env.FRONTEND_URL}/auth/verify?token=${token}`;

  const content = `
    <h1>Verify Your Email Address</h1>
    <p>Welcome to PX39! To complete your registration, please verify your email address by clicking the button below:</p>
    <div style="text-align: center;">
      <a href="${verifyUrl}" class="button">Verify Email</a>
    </div>
    <div class="divider"></div>
    <p>This verification link will expire in 24 hours.</p>
  `;

  const from = `"PX39" <${process.env.SMTP_USER || process.env.EMAIL_USER}>`;

  return safeSendMail({
    from,
    to,
    subject: "Verify Your PX39 Account",
    html: emailTemplate(content),
  });
}

async function sendResetPasswordEmail(to, token) {
  const resetUrl = `${process.env.FRONTEND_URL}/auth/reset-password?token=${token}`;

  const content = `
    <h1>Reset Your Password</h1>
    <p>We received a request to reset your PX39 account password. Click the button below to set a new password:</p>
    <div style="text-align: center;">
      <a href="${resetUrl}" class="button">Reset Password</a>
    </div>
    <div class="divider"></div>
    <p>This link is valid for 1 hour. If you didn't request a password reset, please ignore this email.</p>
  `;

  const from = `"PX39" <${process.env.SMTP_USER || process.env.EMAIL_USER}>`;

  return safeSendMail({
    from,
    to,
    subject: "Reset Your PX39 Password",
    html: emailTemplate(content),
  });
}

async function sendMagicLinkEmail(to, token) {
  const link = `${process.env.BACKEND_URL}/auth/magic?token=${token}`;

  const content = `
    <h1>Your PX39 Login Link</h1>
    <p>Click the button below to securely log in to your PX39 account:</p>
    <div style="text-align: center;">
      <a href="${link}" class="button">Log In to PX39</a>
    </div>
    <div class="divider"></div>
    <p>For security reasons, this link will expire in 15 minutes and can only be used once.</p>
  `;

  const from = `"PX39" <${process.env.SMTP_USER || process.env.EMAIL_USER}>`;

  return safeSendMail({
    from,
    to,
    subject: "Your Secure PX39 Login Link",
    html: emailTemplate(content),
  });
}

async function sendInboundContactEmail({ name, email, phone = "", message }) {
  const adminTo =
    process.env.ADMIN_EMAIL || process.env.SMTP_USER || process.env.EMAIL_USER;
  if (!adminTo) {
    console.warn(
      "sendInboundContactEmail: no ADMIN_EMAIL or SMTP_USER configured"
    );
    return;
  }

  const content = `
    <h1>New Contact Message</h1>
    <p><strong>From:</strong> ${name} &lt;${email}&gt;</p>
    <p><strong>Phone:</strong> ${phone || "-"}</p>
    <div class="divider"></div>
    <p><strong>Message:</strong></p>
    <div style="margin-top:12px;">${String(message).replace(
      /\n/g,
      "<br/>"
    )}</div>
    <div class="divider"></div>
    <p>Visit your admin panel to respond or create a support thread.</p>
  `;

  const from = `"PX39" <${process.env.SMTP_USER || process.env.EMAIL_USER}>`;

  return safeSendMail({
    from,
    to: adminTo,
    subject: `New contact message from ${name}`,
    html: emailTemplate(content),
  });
}

async function sendContactAutoReply({ to, name, message }) {
  if (!to) return;

  const replyContent = message
    ? `<h1>Reply from PX39 Support</h1>
       <p>Hi ${name || "there"},</p>
       <div style="margin-top:12px;">${String(message).replace(
         /\n/g,
         "<br/>"
       )}</div>
       <div class="divider"></div>
       <p>If you'd like to continue the conversation, just reply to this email.</p>`
    : `<h1>We received your message</h1>
       <p>Hi ${name || "there"},</p>
       <p>Thanks for contacting PX39. We've received your message and our team will reply within 24 hours.</p>
       <div class="divider"></div>
       <p>If you need to add more details, just reply to this email.</p>`;

  const from = `"PX39" <${process.env.SMTP_USER || process.env.EMAIL_USER}>`;

  return safeSendMail({
    from,
    to,
    subject: message
      ? "Reply from PX39 Support"
      : "We've received your message — PX39",
    html: emailTemplate(replyContent),
  });
}

module.exports = {
  sendVerificationEmail,
  sendResetPasswordEmail,
  sendMagicLinkEmail,
  sendInboundContactEmail,
  sendContactAutoReply,
  // export transport and verify for debugging if you wish:
  _internal: { transporter },
};
