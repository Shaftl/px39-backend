// backend/utils/email.js
const nodemailer = require("nodemailer");

// ---------- Helpers & config ----------
const DEFAULT_SMTP_PORT = Number(process.env.SMTP_PORT) || 587;
const env = process.env;

// Choose transport mode:
// - Prefer SendGrid if SENDGRID_API_KEY is present
// - Else use provided SMTP_HOST/SMTP_PORT (with a Gmail-port override if host includes 'gmail')
// - If verification fails, fall back to LOG_ONLY mode (no hangs)
let transporter = null;
let transporterOk = false;
let logOnlyMode = false;

function makeSmtpOptions() {
  // prefer SendGrid via smtp.sendgrid.net if API key provided
  if (env.SENDGRID_API_KEY) {
    return {
      host: "smtp.sendgrid.net",
      port: 587,
      secure: false,
      auth: {
        user: "apikey",
        pass: env.SENDGRID_API_KEY,
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000,
      tls: { rejectUnauthorized: false },
    };
  }

  // If SMTP_HOST is set, use that
  if (env.SMTP_HOST) {
    // special-case Gmail to use port 465 with secure true (more reliable in some cloud envs)
    const hostLower = env.SMTP_HOST.toLowerCase();
    if (hostLower.includes("gmail")) {
      return {
        host: env.SMTP_HOST,
        port: Number(env.SMTP_PORT) || 465,
        secure: true,
        auth: {
          user: env.SMTP_USER,
          pass: env.SMTP_PASS,
        },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 10000,
        tls: { rejectUnauthorized: false },
      };
    }

    // generic SMTP
    return {
      host: env.SMTP_HOST,
      port: Number(env.SMTP_PORT) || DEFAULT_SMTP_PORT,
      secure: Number(env.SMTP_PORT) === 465,
      auth: env.SMTP_USER
        ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
        : undefined,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000,
      tls: { rejectUnauthorized: false },
    };
  }

  // No SMTP configured: we will immediately fall back to log-only
  return null;
}

function initTransporter() {
  const opts = makeSmtpOptions();
  if (!opts) {
    console.warn(
      "email: No SMTP config detected — running in LOG_ONLY fallback"
    );
    logOnlyMode = true;
    transporterOk = false;
    transporter = null;
    return;
  }

  transporter = nodemailer.createTransport(opts);

  // verify transporter but do not throw; if verify fails, enable log-only fallback
  transporter
    .verify()
    .then(() => {
      transporterOk = true;
      logOnlyMode = false;
      console.log("email: transporter verified and ready");
    })
    .catch((err) => {
      console.warn(
        "email: transporter verification failed — enabling LOG_ONLY fallback. Error:",
        err && (err.message || err)
      );
      transporterOk = false;
      logOnlyMode = true;
      transporter = transporter; // keep transporter but avoid using it
    });
}

// init at module load
initTransporter();

// If you want to attempt re-verification later, call initTransporter() again from runtime.

function emailTemplate(content) {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>
*{margin:0;padding:0;box-sizing:border-box;font-family: 'TT Norms Pro Trial',Urbanist,'Segoe UI',Roboto,sans-serif}
body{background:#f7fafc;padding:20px;color:#202523;line-height:1.6}
.container{max-width:600px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0}
.header{padding:10px 20px 10px;text-align:center;background:#f8fafc;border-bottom:1px solid #e2e8f0;position:relative}
.header::before{content:"";position:absolute;top:0;left:0;right:0;height:4px;background:linear-gradient(90deg,#f79c12,#202523)}
.logo{height:120px;margin-bottom:5px}.content{padding:40px}h1{font-size:28px;color:#202523;margin-bottom:24px}p{margin-bottom:24px;color:#4a5568}
.button{display:inline-block;background:#202523;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600}
.divider{height:1px;background:linear-gradient(to right,transparent,#e2e8f0,transparent);margin:36px 0}
.footer{padding:24px 20px;text-align:center;color:#718096;background:#f8fafc;border-top:1px solid #e2e8f0}
.code-box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;font-family:monospace;margin:24px 0;text-align:center;color:#4a5568}
</style></head><body><div class="container"><div class="header"><img src="https://res.cloudinary.com/dhljprc8i/image/upload/v1754052548/chat_messages/ccrzxorcfhpmycwejtrw_gq5iaf.png" alt="PX39" class="logo"></div><div class="content">${content}</div><div class="footer"><p>© ${new Date().getFullYear()} PX39. All rights reserved.</p><p>If you didn't request this email, please ignore it.</p></div></div></body></html>`;
}

// safe backend url resolution (fallback)
function resolvedBackendUrl(req) {
  if (
    process.env.BACKEND_URL &&
    !process.env.BACKEND_URL.includes("localhost")
  ) {
    return process.env.BACKEND_URL.replace(/\/+$/, "");
  }
  if (process.env.RENDER_EXTERNAL_URL) {
    return `https://${process.env.RENDER_EXTERNAL_URL}`.replace(/\/+$/, "");
  }
  // If a request object is available, use it (helpful when BACKEND_URL was left as localhost)
  if (req && req.protocol && req.get) {
    return `${req.protocol}://${req.get("host")}`.replace(/\/+$/, "");
  }
  if (
    process.env.FRONTEND_URL &&
    !process.env.FRONTEND_URL.includes("localhost")
  ) {
    return process.env.FRONTEND_URL.replace(/\/+$/, "");
  }
  return "http://localhost:4000";
}

// sendMail helper with timeout and log-only fallback
async function sendMailWithTimeout(mailOptions, timeout = 10000) {
  // if running in log-only fallback, print and resolve quickly
  if (logOnlyMode || !transporterOk) {
    console.warn("email: LOG_ONLY mode - mail would be:", {
      from: mailOptions.from,
      to: mailOptions.to,
      subject: mailOptions.subject,
    });
    // resolve with an object similar to nodemailer's response so callers can proceed
    return Promise.resolve({
      accepted: [mailOptions.to],
      envelope: mailOptions,
      messageId: "log-only",
    });
  }

  // otherwise attempt to send via transporter but race against timeout
  return Promise.race([
    transporter.sendMail(mailOptions),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("nodemailer: timeout")), timeout)
    ),
  ]).catch((err) => {
    // If send failed, switch to log-only to avoid repeated timeouts and surface the error
    console.warn(
      "email: sendMail failed; switching to LOG_ONLY. Error:",
      err && (err.message || err)
    );
    logOnlyMode = true;
    transporterOk = false;
    return Promise.resolve({
      accepted: [mailOptions.to],
      envelope: mailOptions,
      messageId: "falled-back-to-log",
    });
  });
}

// ---------- Exposed send functions ----------
async function sendVerificationEmail(to, token, req = null) {
  const frontend = (
    process.env.FRONTEND_URL || resolvedBackendUrl(req)
  ).replace(/\/+$/, "");
  const verifyUrl = `${frontend}/auth/verify?token=${token}`;
  const content = `
    <h1>Verify Your Email Address</h1>
    <p>Welcome to PX39! To complete your registration, please verify your email address by clicking the button below:</p>
    <div style="text-align:center"><a class="button" href="${verifyUrl}">Verify Email</a></div>
    <div class="divider"></div>
    <p>This verification link will expire in 24 hours.</p>
  `;
  return sendMailWithTimeout({
    from: `"PX39" <${
      process.env.SMTP_USER ||
      process.env.SENDGRID_FROM ||
      "no-reply@example.com"
    }>`,
    to,
    subject: "Verify Your PX39 Account",
    html: emailTemplate(content),
  });
}

async function sendResetPasswordEmail(to, token, req = null) {
  const frontend = (
    process.env.FRONTEND_URL || resolvedBackendUrl(req)
  ).replace(/\/+$/, "");
  const resetUrl = `${frontend}/auth/reset-password?token=${token}`;
  const content = `
    <h1>Reset Your Password</h1>
    <p>We received a request to reset your PX39 account password. Click the button below to set a new password:</p>
    <div style="text-align:center"><a class="button" href="${resetUrl}">Reset Password</a></div>
    <div class="divider"></div>
    <p>This link is valid for 1 hour. If you didn't request a password reset, please ignore this email.</p>
  `;
  return sendMailWithTimeout({
    from: `"PX39" <${
      process.env.SMTP_USER ||
      process.env.SENDGRID_FROM ||
      "no-reply@example.com"
    }>`,
    to,
    subject: "Reset Your PX39 Password",
    html: emailTemplate(content),
  });
}

async function sendMagicLinkEmail(to, token, req = null) {
  // Magic link should point to backend /auth/magic
  const backend = resolvedBackendUrl(req);
  const link = `${backend}/auth/magic?token=${token}`;
  const content = `
    <h1>Your PX39 Login Link</h1>
    <p>Click the button below to securely log in to your PX39 account:</p>
    <div style="text-align:center"><a class="button" href="${link}">Log In to PX39</a></div>
    <div class="divider"></div>
    <p>For security reasons, this link will expire in 15 minutes and can only be used once.</p>
  `;
  return sendMailWithTimeout({
    from: `"PX39" <${
      process.env.SMTP_USER ||
      process.env.SENDGRID_FROM ||
      "no-reply@example.com"
    }>`,
    to,
    subject: "Your Secure PX39 Login Link",
    html: emailTemplate(content),
  });
}

async function sendInboundContactEmail({ name, email, phone = "", message }) {
  const adminTo = process.env.ADMIN_EMAIL || process.env.SMTP_USER;
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
    <div style="margin-top:12px">${String(message).replace(
      /\n/g,
      "<br/>"
    )}</div>
    <div class="divider"></div>
    <p>Visit your admin panel to respond or create a support thread.</p>
  `;
  return sendMailWithTimeout({
    from: `"PX39" <${process.env.SMTP_USER || "no-reply@example.com"}>`,
    to: adminTo,
    subject: `New contact message from ${name}`,
    html: emailTemplate(content),
  });
}

async function sendContactAutoReply({ to, name, message = "" }) {
  if (!to) return;
  const replyContent = message
    ? `<h1>Reply from PX39 Support</h1><p>Hi ${
        name || "there"
      },</p><div style="margin-top:12px">${String(message).replace(
        /\n/g,
        "<br/>"
      )}</div><div class="divider"></div><p>If you'd like to continue the conversation, just reply to this email.</p>`
    : `<h1>We received your message</h1><p>Hi ${
        name || "there"
      },</p><p>Thanks for contacting PX39. We've received your message and our team will reply within 24 hours.</p><div class="divider"></div><p>If you need to add more details, just reply to this email.</p>`;
  return sendMailWithTimeout({
    from: `"PX39" <${process.env.SMTP_USER || "no-reply@example.com"}>`,
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
  // expose for runtime re-init if needed
  _initTransporter: initTransporter,
};
