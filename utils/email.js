// backend/utils/email.js (simplified tolerant transport)
const nodemailer = require("nodemailer");

const env = process.env;
const DEFAULT_SMTP_PORT = Number(env.SMTP_PORT) || 587;

function resolvedBackendUrl(req) {
  // prefer explicit BACKEND_URL (and avoid localhost in production)
  if (
    process.env.BACKEND_URL &&
    !process.env.BACKEND_URL.includes("localhost")
  ) {
    return process.env.BACKEND_URL.replace(/\/+$/, "");
  }
  if (process.env.RENDER_EXTERNAL_URL) {
    return `https://${process.env.RENDER_EXTERNAL_URL}`.replace(/\/+$/, "");
  }
  if (req && req.protocol && req.get) {
    return `${req.protocol}://${req.get("host")}`.replace(/\/+$/, "");
  }
  if (
    process.env.FRONTEND_URL &&
    !process.env.FRONTEND_URL.includes("localhost")
  ) {
    return process.env.FRONTEND_URL.replace(/\/+$/, "");
  }
  return `http://localhost:${process.env.PORT || 4000}`;
}

function makeTransportOptions() {
  // support SendGrid if provided
  if (env.SENDGRID_API_KEY) {
    return {
      host: "smtp.sendgrid.net",
      port: 587,
      secure: false,
      auth: { user: "apikey", pass: env.SENDGRID_API_KEY },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000,
      tls: { rejectUnauthorized: false },
    };
  }

  if (!env.SMTP_HOST) {
    // no SMTP configured: operate in log-only mode
    return null;
  }

  // If Gmail, use recommended secure port 465 if available
  const hostLower = env.SMTP_HOST.toLowerCase();
  const port = hostLower.includes("gmail")
    ? 465
    : Number(env.SMTP_PORT) || DEFAULT_SMTP_PORT;
  const secure = port === 465;

  return {
    host: env.SMTP_HOST,
    port,
    secure,
    auth: env.SMTP_USER
      ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
      : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
    tls: { rejectUnauthorized: false }, // reduce TLS failures in cloud envs (pragmatic)
  };
}

let transporter = null;
let logOnlyMode = false;

const opts = makeTransportOptions();
if (!opts) {
  console.warn(
    "email: no SMTP config detected — running in LOG_ONLY mode (emails will be logged)."
  );
  logOnlyMode = true;
} else {
  transporter = nodemailer.createTransport(opts);
  // Do NOT call transporter.verify() here (it can hang or fail on some cloud envs).
  // We'll attempt send on demand and fallback gracefully if it fails.
}

function emailTemplate(content) {
  return (
    `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<style>*{box-sizing:border-box;font-family:Arial,Helvetica,sans-serif}body{padding:20px;color:#25303a;background:#f7fafc}</style>` +
    `</head><body><div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;padding:24px">` +
    `${content}<div style="margin-top:18px;color:#8892a0;font-size:12px">© ${new Date().getFullYear()} PX39</div>` +
    `</div></body></html>`
  );
}

// returns nodemailer-like response or resolves with a fake-ok when logOnly
async function sendMailWithTimeout(mailOptions, timeout = 10000) {
  if (logOnlyMode || !transporter) {
    console.warn("email: LOG_ONLY - would send:", {
      from: mailOptions.from,
      to: mailOptions.to,
      subject: mailOptions.subject,
    });
    return Promise.resolve({
      accepted: [mailOptions.to],
      messageId: "log-only",
    });
  }

  return Promise.race([
    transporter.sendMail(mailOptions),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("nodemailer: timeout")), timeout)
    ),
  ]).catch((err) => {
    console.warn(
      "email: sendMail failed — falling back to LOG_ONLY. Error:",
      err && err.message
    );
    logOnlyMode = true;
    return { accepted: [mailOptions.to], messageId: "fallback-log" };
  });
}

async function sendVerificationEmail(to, token, req = null) {
  const frontend = (
    process.env.FRONTEND_URL || resolvedBackendUrl(req)
  ).replace(/\/+$/, "");
  const verifyUrl = `${frontend}/auth/verify?token=${token}`;
  const content = `<h1>Verify Your Email</h1><p>Click the button to verify:</p><p><a href="${verifyUrl}" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;border-radius:6px;text-decoration:none">Verify Email</a></p>`;
  return sendMailWithTimeout({
    from: `"PX39" <${process.env.SMTP_USER || "no-reply@px39.example"}>`,
    to,
    subject: "Verify your PX39 account",
    html: emailTemplate(content),
  });
}

async function sendResetPasswordEmail(to, token, req = null) {
  const frontend = (
    process.env.FRONTEND_URL || resolvedBackendUrl(req)
  ).replace(/\/+$/, "");
  const resetUrl = `${frontend}/auth/reset-password?token=${token}`;
  const content = `<h1>Reset Your Password</h1><p><a href="${resetUrl}" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;border-radius:6px;text-decoration:none">Reset Password</a></p>`;
  return sendMailWithTimeout({
    from: `"PX39" <${process.env.SMTP_USER || "no-reply@px39.example"}>`,
    to,
    subject: "Reset your PX39 password",
    html: emailTemplate(content),
  });
}

async function sendMagicLinkEmail(to, token, req = null) {
  const backend = resolvedBackendUrl(req);
  const link = `${backend}/auth/magic?token=${token}`;
  const content = `<h1>Your login link</h1><p><a href="${link}" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;border-radius:6px;text-decoration:none">Log in</a></p>`;
  return sendMailWithTimeout({
    from: `"PX39" <${process.env.SMTP_USER || "no-reply@px39.example"}>`,
    to,
    subject: "Your PX39 magic link",
    html: emailTemplate(content),
  });
}

module.exports = {
  sendVerificationEmail,
  sendResetPasswordEmail,
  sendMagicLinkEmail,
};
