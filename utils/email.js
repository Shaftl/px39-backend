// backend/utils/email.js
const nodemailer = require("nodemailer");

const SMTP_HOST = process.env.SMTP_HOST || "smtp.gmail.com";
const SMTP_PORT = Number(process.env.SMTP_PORT) || 587;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;

// Use secure when using port 465
const secure = SMTP_PORT === 465;

const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure,
  auth:
    SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
  connectionTimeout: 20000, // 20s
  greetingTimeout: 20000,
  socketTimeout: 20000,
  tls: {
    // reduces TLS certificate validation errors (less strict).
    // NOTE: this is a pragmatic fallback for hosting environments
    // that may block or present different TLS chains. Use with care.
    rejectUnauthorized: false,
  },
});

// optional: verify SMTP connection on startup (logs)
transporter.verify((err, success) => {
  if (err) {
    console.warn("⚠️  Nodemailer verify failed:", err && err.message);
  } else {
    console.log("✅ Nodemailer ready to send emails");
  }
});

function emailTemplate(content) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>/* keep your existing CSS here (omitted for brevity) */ body{font-family:Arial,Helvetica,sans-serif}</style></head><body>${content}</body></html>`;
}

// small helper that races sendMail against a timeout (keeps behavior you had)
async function sendMailWithTimeout(mailOptions, timeout = 20000) {
  return Promise.race([
    transporter.sendMail(mailOptions),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("nodemailer: timeout")), timeout)
    ),
  ]);
}

const FRONTEND_URL =
  process.env.FRONTEND_URL ||
  process.env.FRONTEND_ORIGIN ||
  "https://px39-test-final.vercel.app";
// BACKEND_URL fallback — IMPORTANT: set this in Render to your public backend URL
const BACKEND_URL =
  process.env.BACKEND_URL || "https://px39-backend-1.onrender.com";

async function sendVerificationEmail(to, token) {
  const verifyUrl = `${FRONTEND_URL.replace(
    /\/$/,
    ""
  )}/auth/verify?token=${token}`;
  const content = `<h1>Verify Your Email Address</h1><p>Click the button below to verify:</p><div style="text-align:center"><a href="${verifyUrl}" style="padding:12px 20px;background:#111;color:#fff;border-radius:8px;text-decoration:none;">Verify Email</a></div>`;
  return sendMailWithTimeout({
    from: `"PX39" <${SMTP_USER}>`,
    to,
    subject: "Verify Your PX39 Account",
    html: emailTemplate(content),
  });
}

async function sendResetPasswordEmail(to, token) {
  const resetUrl = `${FRONTEND_URL.replace(
    /\/$/,
    ""
  )}/auth/reset-password?token=${token}`;
  const content = `<h1>Reset Password</h1><p>Click below to reset:</p><div style="text-align:center"><a href="${resetUrl}" style="padding:12px 20px;background:#111;color:#fff;border-radius:8px;text-decoration:none;">Reset Password</a></div>`;
  return sendMailWithTimeout({
    from: `"PX39" <${SMTP_USER}>`,
    to,
    subject: "Reset Your PX39 Password",
    html: emailTemplate(content),
  });
}

async function sendMagicLinkEmail(to, token) {
  const link = `${BACKEND_URL.replace(/\/$/, "")}/auth/magic?token=${token}`;
  const content = `<h1>Your Magic Login Link</h1><p>Click to sign in (expires 15 minutes):</p><div style="text-align:center"><a href="${link}" style="padding:12px 20px;background:#111;color:#fff;border-radius:8px;text-decoration:none;">Log In</a></div>`;
  return sendMailWithTimeout({
    from: `"PX39" <${SMTP_USER}>`,
    to,
    subject: "Your PX39 Login Link",
    html: emailTemplate(content),
  });
}

async function sendInboundContactEmail({ name, email, phone = "", message }) {
  const adminTo = process.env.ADMIN_EMAIL || SMTP_USER;
  if (!adminTo) {
    console.warn(
      "sendInboundContactEmail: no ADMIN_EMAIL or SMTP_USER configured"
    );
    return;
  }
  const content = `<h1>New Contact</h1><p>From: ${name} &lt;${email}&gt;</p><p>Message:</p><div>${String(
    message
  ).replace(/\n/g, "<br/>")}</div>`;
  return sendMailWithTimeout({
    from: `"PX39" <${SMTP_USER}>`,
    to: adminTo,
    subject: `New contact from ${name}`,
    html: emailTemplate(content),
  });
}

async function sendContactAutoReply({ to, name, message }) {
  if (!to) return;
  const replyContent = message
    ? `<h1>Reply</h1><p>Hi ${name || "there"},</p><div>${String(
        message
      ).replace(/\n/g, "<br/>")}</div>`
    : `<h1>We received your message</h1><p>Thanks for contacting PX39.</p>`;
  return sendMailWithTimeout({
    from: `"PX39" <${SMTP_USER}>`,
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
  transporter, // export for testing if needed
};
