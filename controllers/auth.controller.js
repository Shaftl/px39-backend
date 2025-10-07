// backend/controllers/auth.controller.js (simplified)
require("dotenv").config();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const UAParser = require("ua-parser-js");
const ms = require("ms");

const User = require("../models/User");
const { createAccessToken, createRefreshToken } = require("../utils/token");
const {
  sendVerificationEmail,
  sendResetPasswordEmail,
  sendMagicLinkEmail,
} = require("../utils/email");

const isProd = process.env.NODE_ENV === "production";

const makeCookieOptions = (maxAge) => ({
  httpOnly: true,
  secure: isProd, // must be true in production to allow SameSite=None
  sameSite: isProd ? "none" : "lax",
  maxAge,
  path: "/",
});

const makeClearCookieOptions = () => ({
  httpOnly: true,
  secure: isProd,
  sameSite: isProd ? "none" : "lax",
  path: "/",
});

async function register(req, res) {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password)
      return res
        .status(400)
        .json({ message: "Username, email, and password are required." });

    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser)
      return res
        .status(409)
        .json({ message: "Username or email already in use." });

    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(password, salt);
    const newUser = await User.create({ username, email, passwordHash });

    const token = crypto.randomBytes(32).toString("hex");
    newUser.verificationToken = token;
    newUser.verificationTokenExpiry = Date.now() + 60 * 60 * 1000;
    await newUser.save();

    try {
      // PASS req so helper can compute correct frontend/backend host
      await sendVerificationEmail(newUser.email, token, req);
    } catch (emailErr) {
      console.warn(
        "sendVerificationEmail failed:",
        emailErr && emailErr.message
      );
    }

    return res.status(201).json({
      message:
        "Registration successful! Please check your email to verify your account.",
      user: {
        id: newUser._id,
        username: newUser.username,
        email: newUser.email,
        role: newUser.role || "user",
      },
    });
  } catch (err) {
    console.error("Registration error:", err);
    return res
      .status(500)
      .json({ message: "Server error during registration." });
  }
}

async function verifyEmail(req, res) {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ message: "Token required." });

    const user = await User.findOne({
      verificationToken: token,
      verificationTokenExpiry: { $gt: Date.now() },
    });
    if (!user)
      return res.status(400).json({ message: "Invalid/expired token." });

    user.emailVerified = true;
    user.verificationToken = undefined;
    user.verificationTokenExpiry = undefined;

    const payload = { userId: user._id, role: user.role };
    const accessToken = createAccessToken(payload);
    const refreshToken = createRefreshToken(payload);

    const parser = new UAParser(req.get("User-Agent"));
    const ua = parser.getResult();
    user.sessions.push({
      tokenId: `${user.sessions.length + 1}-${Date.now()}`,
      ip: req.ip || req.connection.remoteAddress,
      browser: `${ua.browser.name || "Unknown"} ${
        ua.browser.version || ""
      }`.trim(),
      os: `${ua.os.name || "Unknown"} ${ua.os.version || ""}`.trim(),
      device: ua.device.type || "Desktop",
    });
    await user.save();

    const accessMaxAge = ms(process.env.ACCESS_TOKEN_EXPIRES_IN || "15m");
    const refreshMaxAge = ms(process.env.REFRESH_TOKEN_EXPIRES_IN || "7d");

    return res
      .cookie("accessToken", accessToken, makeCookieOptions(accessMaxAge))
      .cookie("refreshToken", refreshToken, makeCookieOptions(refreshMaxAge))
      .json({
        message: "Email verified and logged in successfully.",
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          role: user.role,
          avatarUrl: user.avatarUrl || null,
        },
      });
  } catch (err) {
    console.error("Verify email error:", err);
    return res.status(500).json({ message: "Server error verifying email." });
  }
}

async function resendVerification(req, res) {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email is required." });

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: "No account found." });
    if (user.emailVerified)
      return res.status(400).json({ message: "Already verified." });

    const now = Date.now();
    const WINDOW_MS = 30 * 1000;
    if (
      user.lastVerificationSent &&
      now - user.lastVerificationSent.getTime() < WINDOW_MS
    ) {
      const remaining = Math.ceil(
        (WINDOW_MS - (now - user.lastVerificationSent.getTime())) / 1000
      );
      return res.status(429).json({ message: `Please wait ${remaining} sec` });
    }

    const token = crypto.randomBytes(32).toString("hex");
    user.verificationToken = token;
    user.verificationTokenExpiry = now + 60 * 60 * 1000;
    user.lastVerificationSent = new Date(now);
    await user.save();

    try {
      await sendVerificationEmail(user.email, token, req);
    } catch (emailErr) {
      console.warn(
        "sendVerificationEmail (resend) failed:",
        emailErr && emailErr.message
      );
    }

    return res.json({ message: "Verification email resent." });
  } catch (err) {
    console.error("Resend verification error:", err);
    return res.status(500).json({ message: "Server error." });
  }
}

async function login(req, res) {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ message: "Email and password required." });

    const user = await User.findOne({ email });
    if (!user || user.status !== "active")
      return res.status(401).json({ message: "Invalid credentials." });
    if (!user.emailVerified)
      return res.status(403).json({ message: "Please verify your email." });

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch)
      return res.status(401).json({ message: "Invalid credentials." });

    const payload = { userId: user._id, role: user.role };
    const accessToken = createAccessToken(payload);
    const refreshToken = createRefreshToken(payload);

    const parser = new UAParser(req.get("User-Agent"));
    const ua = parser.getResult();
    user.sessions.push({
      tokenId: `${user.sessions.length + 1}-${Date.now()}`,
      ip: req.ip || req.connection.remoteAddress,
      browser: `${ua.browser.name || "Unknown"} ${
        ua.browser.version || ""
      }`.trim(),
      os: `${ua.os.name || "Unknown"} ${ua.os.version || ""}`.trim(),
      device: ua.device.type || "Desktop",
    });
    await user.save();

    const accessMaxAge = ms(process.env.ACCESS_TOKEN_EXPIRES_IN || "15m");
    const refreshMaxAge = ms(process.env.REFRESH_TOKEN_EXPIRES_IN || "7d");

    return res
      .cookie("accessToken", accessToken, makeCookieOptions(accessMaxAge))
      .cookie("refreshToken", refreshToken, makeCookieOptions(refreshMaxAge))
      .json({
        message: "Logged in successfully.",
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          role: user.role,
          avatarUrl: user.avatarUrl || null,
        },
      });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ message: "Server error during login." });
  }
}

async function requestPasswordReset(req, res) {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email is required." });

    const user = await User.findOne({ email });
    if (!user)
      return res.status(404).json({ message: "No account with that email." });

    const token = crypto.randomBytes(32).toString("hex");
    user.resetPasswordToken = token;
    user.resetPasswordExpiry = Date.now() + 60 * 60 * 1000;
    await user.save();

    try {
      await sendResetPasswordEmail(user.email, token, req);
    } catch (emailErr) {
      console.warn(
        "sendResetPasswordEmail failed:",
        emailErr && emailErr.message
      );
    }

    return res.json({ message: "Password reset email sent." });
  } catch (err) {
    console.error("Request password reset error:", err);
    return res.status(500).json({ message: "Server error." });
  }
}

async function requestMagicLink(req, res) {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email is required." });
    const user = await User.findOne({ email });
    if (!user)
      return res.status(404).json({ message: "No account with that email." });

    const token = crypto.randomBytes(32).toString("hex");
    user.magicLinkToken = token;
    user.magicLinkExpiry = Date.now() + 15 * 60 * 1000;
    await user.save();

    // ensure BACKEND_URL fallback
    if (
      !process.env.BACKEND_URL ||
      process.env.BACKEND_URL.includes("localhost")
    ) {
      process.env.BACKEND_URL =
        process.env.BACKEND_URL || `${req.protocol}://${req.get("host")}`;
    }

    try {
      await sendMagicLinkEmail(user.email, token, req);
    } catch (emailErr) {
      console.warn("sendMagicLinkEmail failed:", emailErr && emailErr.message);
    }

    return res.json({ message: "Magic link sent! Check your email." });
  } catch (err) {
    console.error("requestMagicLink error:", err);
    return res.status(500).json({ message: "Server error." });
  }
}

async function magicLogin(req, res) {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).send("Token is required.");

    const user = await User.findOne({
      magicLinkToken: token,
      magicLinkExpiry: { $gt: Date.now() },
    });
    if (!user) return res.status(400).send("Invalid or expired magic link.");

    user.magicLinkToken = undefined;
    user.magicLinkExpiry = undefined;

    const payload = { userId: user._id, role: user.role };
    const accessToken = createAccessToken(payload);
    const refreshToken = createRefreshToken(payload);

    const parser = new UAParser(req.get("User-Agent"));
    const ua = parser.getResult();
    user.sessions.push({
      tokenId: `${user.sessions.length + 1}-${Date.now()}`,
      ip: req.ip || req.connection.remoteAddress,
      browser: `${ua.browser.name || "Unknown"} ${
        ua.browser.version || ""
      }`.trim(),
      os: `${ua.os.name || "Unknown"} ${ua.os.version || ""}`.trim(),
      device: ua.device.type || "Desktop",
    });
    await user.save();

    const accessMaxAge = ms(process.env.ACCESS_TOKEN_EXPIRES_IN || "15m");
    const refreshMaxAge = ms(process.env.REFRESH_TOKEN_EXPIRES_IN || "7d");

    const frontendUrl =
      process.env.FRONTEND_ORIGIN ||
      process.env.FRONTEND_URL ||
      "https://px39-test-final.vercel.app";

    return res
      .cookie("accessToken", accessToken, makeCookieOptions(accessMaxAge))
      .cookie("refreshToken", refreshToken, makeCookieOptions(refreshMaxAge))
      .redirect(`${frontendUrl}/`);
  } catch (err) {
    console.error("Magic login error:", err);
    return res.status(500).send("Server error during magic login.");
  }
}

async function logout(req, res) {
  try {
    const clearOpts = makeClearCookieOptions();
    return res
      .clearCookie("accessToken", clearOpts)
      .clearCookie("refreshToken", clearOpts)
      .json({ message: "Logged out successfully." });
  } catch (err) {
    console.error("Logout error:", err);
    return res.status(500).json({ message: "Server error during logout." });
  }
}

module.exports = {
  register,
  verifyEmail,
  resendVerification,
  login,
  requestPasswordReset,
  requestMagicLink,
  magicLogin,
  logout,
  // other handlers unchanged — export what you need
};
