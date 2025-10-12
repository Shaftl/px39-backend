const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const emailTemplate = (content) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
      font-family: 'TT Norms Pro Trial', Urbanist, 'Segoe UI', Roboto, sans-serif;
    }
    
    body {
      background-color: #f7fafc;
      background-image: url("data:image/svg+xml,%3Csvg width='100' height='100' viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M11 18c3.866 0 7-3.134 7-7s-3.134-7-7-7-7 3.134-7 7 3.134 7 7 7zm48 25c3.866 0 7-3.134 7-7s-3.134-7-7-7-7 3.134-7 7 3.134 7 7 7zm-43-7c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zm63 31c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zM34 90c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zm56-76c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zM12 86c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm28-65c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm23-11c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm-6 60c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm29 22c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zM32 63c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm57-13c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm-9-21c1.105 0 2-.895 2-2s-.895-2-2-2-2 .895-2 2 .895 2 2 2zM60 91c1.105 0 2-.895 2-2s-.895-2-2-2-2 .895-2 2 .895 2 2 2zM35 41c1.105 0 2-.895 2-2s-.895-2-2-2-2 .895-2 2 .895 2 2 2zM12 60c1.105 0 2-.895 2-2s-.895-2-2-2-2 .895-2 2 .895 2 2 2z' fill='%23e2e8f0' fill-opacity='0.2' fill-rule='evenodd'/%3E%3C/svg%3E");
      color: #202523;
      padding: 20px;
      line-height: 1.6;
    }
    
    .container {
      max-width: 600px;
      margin: 0 auto;
      background: #ffffff;
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05), 
                  0 8px 10px -6px rgba(0, 0, 0, 0.04);
      border: 1px solid #e2e8f0;
    }
    
    .header {
      padding: 10px 20px 10px;
      text-align: center;
      background: #f8fafc;
      border-bottom: 1px solid #e2e8f0;
      position: relative;
    }
    
    .header::before {
      content: "";
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 4px;
      background: linear-gradient(90deg, #f79c12, #202523);
    }
    
    .logo {
      height: 120px;
      margin-bottom: 5px;
    }
    
    .content {
      padding: 40px;
    }
    
    h1 {
      font-family: 'TT Travels Next Trial Variable', sans-serif;
      font-size: 28px;
      font-weight: 700;
      margin-bottom: 24px;
      letter-spacing: -0.01em;
      color: #202523;
      line-height: 1.3;
    }
    
    p {
      margin-bottom: 24px;
      color: #4a5568;
      font-size: 16px;
      line-height: 1.7;
    }
    
    .button-container {
      text-align: center;
      margin: 32px 0;
    }
    
    .button {
      display: inline-block;
      background: #202523;
      color: #ffffff !important;
      text-decoration: none;
      padding: 14px 32px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 16px;
      transition: all 0.3s ease;
      letter-spacing: 0.02em;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 
                  0 2px 4px -1px rgba(0, 0, 0, 0.03);
      border: 1px solid transparent;
    }
    
    .button:hover {
      background: #0d0f0e;
      transform: translateY(-2px);
      box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.07), 
                  0 4px 6px -2px rgba(0, 0, 0, 0.04);
    }
    
    .divider {
      height: 1px;
      background: linear-gradient(to right, transparent, #e2e8f0, transparent);
      margin: 36px 0;
    }
    
    .footer {
      padding: 24px 20px;
      text-align: center;
      color: #718096;
      font-size: 14px;
      background: #f8fafc;
      border-top: 1px solid #e2e8f0;
    }
    
    .footer p {
      margin-bottom: 8px;
      font-size: 14px;
    }
    
    .code-box {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 16px;
      font-family: monospace;
      margin: 24px 0;
      text-align: center;
      color: #4a5568;
      font-size: 15px;
      word-break: break-all;
      box-shadow: inset 0 2px 4px 0 rgba(0,0,0,0.03);
    }
    
    .highlight {
      color: #f79c12;
      font-weight: 600;
    }
    
    .info-text {
      font-size: 14px;
      color: #718096;
      margin-top: 8px;
    }
    
    @media (max-width: 600px) {
      .content {
        padding: 30px 20px;
      }
      
      h1 {
        font-size: 24px;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="https://res.cloudinary.com/dhljprc8i/image/upload/v1754052548/chat_messages/ccrzxorcfhpmycwejtrw_gq5iaf.png" alt="PX39" class="logo">
    </div>
    
    <div class="content">
      ${content}
    </div>
    
    <div class="footer">
      <p>© ${new Date().getFullYear()} PX39. All rights reserved.</p>
      <p>If you didn't request this email, please ignore it.</p>
    </div>
  </div>
</body>
</html>
`;

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

  await transporter.sendMail({
    from: `"PX39" <${process.env.SMTP_USER}>`,
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

  await transporter.sendMail({
    from: `"PX39" <${process.env.SMTP_USER}>`,
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

  await transporter.sendMail({
    from: `"PX39" <${process.env.SMTP_USER}>`,
    to,
    subject: "Your Secure PX39 Login Link",
    html: emailTemplate(content),
  });
}

/**
 * New helper: send inbound contact notification to admin
 * - Keeps your existing template/visual style
 * - Uses ADMIN_EMAIL (fallback to SMTP_USER if not set)
 *
 * Usage:
 *   const { sendInboundContactEmail } = require("../utils/email");
 *   await sendInboundContactEmail({ name, email, phone, message });
 */
async function sendInboundContactEmail({ name, email, phone = "", message }) {
  const adminTo = process.env.ADMIN_EMAIL || process.env.SMTP_USER;
  if (!adminTo) {
    // nothing to send to — avoid throwing to not break caller flow
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

  await transporter.sendMail({
    from: `"PX39" <${process.env.SMTP_USER}>`,
    to: adminTo,
    subject: `New contact message from ${name}`,
    html: emailTemplate(content),
  });
}

/**
 * sendContactAutoReply
 * - Now accepts an optional custom message (string) that will be delivered to the user.
 * - If message is not provided, falls back to the previous generic confirmation content.
 *
 * Usage:
 *   await sendContactAutoReply({ to: "user@example.com", name: "Rohullah", message: "Thanks — here's the reply" });
 */
async function sendContactAutoReply({ to, name, message }) {
  if (!to) return;

  // If admin provided a custom message, include it; otherwise use the default text
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

  await transporter.sendMail({
    from: `"PX39" <${process.env.SMTP_USER}>`,
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
  // newly exported helpers:
  sendInboundContactEmail,
  sendContactAutoReply,
};
