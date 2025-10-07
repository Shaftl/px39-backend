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
  secure: isProd, // must be true for SameSite=None & cross-site cookies
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

    // send email but don't fail registration if SMTP fails
    try {
      // <-- PASS req so email helper can build correct runtime FRONTEND URL if BACKEND_URL wasn't set
      await sendVerificationEmail(newUser.email, token, req);
    } catch (emailErr) {
      console.warn(
        "sendVerificationEmail failed:",
        emailErr && (emailErr.message || emailErr)
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
    if (!token)
      return res
        .status(400)
        .json({ message: "Verification token is required." });

    const user = await User.findOne({
      verificationToken: token,
      verificationTokenExpiry: { $gt: Date.now() },
    });
    if (!user)
      return res.status(400).json({ message: "Invalid or expired token." });

    user.emailVerified = true;
    user.verificationToken = undefined;
    user.verificationTokenExpiry = undefined;

    const payload = { userId: user._id, role: user.role };
    const accessToken = createAccessToken(payload);
    const refreshToken = createRefreshToken(payload);

    const parser = new UAParser(req.get("User-Agent"));
    const { browser, os, device } = parser.getResult();
    user.sessions.push({
      tokenId: `${user.sessions.length + 1}-${Date.now()}`,
      ip: req.ip || req.connection.remoteAddress,
      browser: `${browser.name} ${browser.version}`,
      os: `${os.name} ${os.version}`,
      device: device.type || "Desktop",
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
    if (!user)
      return res
        .status(404)
        .json({ message: "No account found with that email." });
    if (user.emailVerified)
      return res.status(400).json({ message: "Email is already verified." });

    const now = Date.now();
    const WINDOW_MS = 30 * 1000;

    if (
      user.lastVerificationSent &&
      now - user.lastVerificationSent.getTime() < WINDOW_MS
    ) {
      const remainingMs =
        WINDOW_MS - (now - user.lastVerificationSent.getTime());
      const totalSec = Math.ceil(remainingMs / 1000);
      const minutes = Math.floor(totalSec / 60);
      const seconds = totalSec % 60;
      const parts = [];
      if (minutes > 0) parts.push(`${minutes} min`);
      parts.push(`${seconds} sec`);

      return res.status(429).json({
        message: `Please wait ${parts.join(
          " "
        )} before requesting another email.`,
      });
    }

    const token = crypto.randomBytes(32).toString("hex");
    user.verificationToken = token;
    user.verificationTokenExpiry = now + 60 * 60 * 1000;
    user.lastVerificationSent = new Date(now);
    await user.save();

    try {
      // <-- PASS req so runtime frontend resolution is correct
      await sendVerificationEmail(user.email, token, req);
    } catch (emailErr) {
      console.warn(
        "sendVerificationEmail (resend) failed:",
        emailErr && (emailErr.message || emailErr)
      );
    }

    return res.json({
      message: "Verification email resent. Please check your inbox.",
    });
  } catch (err) {
    console.error("Resend verification error:", err);
    return res
      .status(500)
      .json({ message: "Server error resending verification email." });
  }
}

async function login(req, res) {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res
        .status(400)
        .json({ message: "Email and password are required." });

    const user = await User.findOne({ email });
    if (!user || user.status !== "active")
      return res.status(401).json({ message: "Invalid credentials." });
    if (!user.emailVerified)
      return res
        .status(403)
        .json({ message: "Please verify your email before logging in." });

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

async function setAvatarUrl(req, res) {
  try {
    const userId = req.user._id;
    const { avatarUrl } = req.body;
    if (!avatarUrl) return res.status(400).json({ message: "No URL provided" });

    const user = await User.findByIdAndUpdate(
      userId,
      { avatarUrl },
      { new: true }
    ).select("avatarUrl");
    return res.json({ avatarUrl: user.avatarUrl });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Could not update avatar" });
  }
}

async function refreshToken(req, res) {
  try {
    const token = req.cookies.refreshToken;
    if (!token)
      return res.status(401).json({ message: "Refresh token missing." });

    const payload = jwt.verify(token, process.env.REFRESH_TOKEN_SECRET);
    const user = await User.findById(payload.userId);
    if (!user)
      return res.status(401).json({ message: "Invalid refresh token." });

    const newPayload = { userId: user._id, role: user.role };
    const newAccessToken = createAccessToken(newPayload);
    const newRefreshToken = createRefreshToken(newPayload);

    const accessMaxAge = ms(process.env.ACCESS_TOKEN_EXPIRES_IN || "15m");
    const refreshMaxAge = ms(process.env.REFRESH_TOKEN_EXPIRES_IN || "7d");

    return res
      .cookie("accessToken", newAccessToken, makeCookieOptions(accessMaxAge))
      .cookie("refreshToken", newRefreshToken, makeCookieOptions(refreshMaxAge))
      .json({ message: "Tokens refreshed." });
  } catch (err) {
    console.error("Refresh token error:", err);
    return res
      .status(401)
      .json({ message: "Invalid or expired refresh token." });
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
      // <-- PASS req so email helper constructs the right frontend reset link
      await sendResetPasswordEmail(user.email, token, req);
    } catch (emailErr) {
      console.warn(
        "sendResetPasswordEmail failed:",
        emailErr && (emailErr.message || emailErr)
      );
    }

    return res.json({ message: "Password reset email sent." });
  } catch (err) {
    console.error("Request password reset error:", err);
    return res.status(500).json({ message: "Server error." });
  }
}

async function resetPassword(req, res) {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword)
      return res
        .status(400)
        .json({ message: "Token and new password are required." });

    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpiry: { $gt: Date.now() },
    });
    if (!user)
      return res.status(400).json({ message: "Invalid or expired token." });

    const salt = await bcrypt.genSalt(12);
    user.passwordHash = await bcrypt.hash(newPassword, salt);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpiry = undefined;
    user.sessions = [];
    await user.save();

    return res.json({ message: "Password has been reset successfully." });
  } catch (err) {
    console.error("Reset password error:", err);
    return res.status(500).json({ message: "Server error." });
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

async function getSessions(req, res) {
  return res.json({ sessions: req.user.sessions });
}

async function revokeSession(req, res) {
  const { tokenId } = req.params;
  const user = req.user;
  user.sessions = user.sessions.filter((s) => s.tokenId !== tokenId);
  await user.save();
  return res.json({ message: "Session revoked." });
}

async function requestMagicLink(req, res) {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: "Email is required." });

  const user = await User.findOne({ email });
  if (!user)
    return res.status(404).json({ message: "No account with that email." });

  const token = crypto.randomBytes(32).toString("hex");
  user.magicLinkToken = token;
  user.magicLinkExpiry = Date.now() + 15 * 60 * 1000;
  await user.save();

  // ensure BACKEND_URL is correct for the environment — fallback to request host
  if (
    !process.env.BACKEND_URL ||
    process.env.BACKEND_URL.includes("localhost")
  ) {
    const computed = `${req.protocol}://${req.get("host")}`;
    process.env.BACKEND_URL = process.env.BACKEND_URL || computed;
  }

  try {
    // <-- PASS req so email helper builds link to actual deployed backend
    await sendMagicLinkEmail(user.email, token, req);
  } catch (emailErr) {
    console.warn(
      "sendMagicLinkEmail failed:",
      emailErr && (emailErr.message || emailErr)
    );
  }

  return res.json({ message: "Magic link sent! Check your email." });
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
      browser: `${ua.browser.name} ${ua.browser.version}`.trim(),
      os: `${ua.os.name} ${ua.os.version}`.trim(),
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

async function updateProfile(req, res) {
  try {
    const { username, email } = req.body;
    const user = await User.findById(req.user._id);
    if (username) user.username = username;
    if (email) user.email = email;
    await user.save();
    return res.json({
      message: "Profile updated.",
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        avatarUrl: user.avatarUrl,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Could not update profile." });
  }
}

async function deleteAccount(req, res) {
  try {
    await User.findByIdAndUpdate(req.user._id, { status: "deleted" });
    const clearOpts = makeClearCookieOptions();
    res
      .clearCookie("accessToken", clearOpts)
      .clearCookie("refreshToken", clearOpts);
    return res.json({ message: "Account deleted." });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Could not delete account." });
  }
}

module.exports = {
  register,
  verifyEmail,
  resendVerification,
  login,
  refreshToken,
  requestPasswordReset,
  resetPassword,
  logout,
  getSessions,
  revokeSession,
  requestMagicLink,
  setAvatarUrl,
  magicLogin,
  deleteAccount,
  updateProfile,
};
