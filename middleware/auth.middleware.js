// backend/middleware/auth.middleware.js
// Hardened auth middleware: accepts token from cookie, alt cookie name, Authorization header, or query param.
// Still enforces: user exists and user.status === "active"

const jwt = require("jsonwebtoken");
const User = require("../models/User");

async function authMiddleware(req, res, next) {
  try {
    // Accept tokens from multiple common sources for robustness:
    //  - cookie named 'accessToken'
    //  - cookie named 'token'
    //  - Authorization: Bearer <token>
    //  - query param ?token=...
    const cookieToken =
      (req.cookies && (req.cookies.accessToken || req.cookies.token)) || null;

    const authHeader =
      (req.get && (req.get("Authorization") || req.get("authorization"))) || "";

    let token = cookieToken;

    if (
      !token &&
      typeof authHeader === "string" &&
      authHeader.startsWith("Bearer ")
    ) {
      token = authHeader.slice(7).trim();
    }

    if (!token && req.query && req.query.token) {
      token = String(req.query.token);
    }

    if (!token) {
      return res.status(401).json({ message: "Access token missing." });
    }

    // Verify token
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      // defensive: avoid throwing if secret missing in environment
      console.error("authMiddleware: JWT_SECRET is not configured");
      return res.status(500).json({ message: "Server configuration error." });
    }

    let payload;
    try {
      payload = jwt.verify(token, secret);
    } catch (err) {
      console.warn("authMiddleware: token verify failed:", err.message);
      return res.status(401).json({ message: "Invalid or expired token." });
    }

    // Support payload that contains userId or id
    const userId = (payload && (payload.userId || payload.id)) || null;
    if (!userId) {
      return res.status(401).json({ message: "Invalid token payload." });
    }

    // Load user and attach (exclude sensitive fields)
    const user = await User.findById(userId).select("-passwordHash");
    if (!user || user.status !== "active") {
      return res.status(401).json({ message: "Invalid or inactive user." });
    }

    req.user = user;
    return next();
  } catch (err) {
    console.error("Auth middleware error:", err);
    return res.status(401).json({ message: "Invalid or expired token." });
  }
}

module.exports = authMiddleware;
