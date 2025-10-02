// backend/middleware/optionalAuth.middleware.js
const jwt = require("jsonwebtoken");
const User = require("../models/User");

async function optionalAuth(req, res, next) {
  try {
    // Accept either cookie name 'accessToken' or 'token' (many apps use one or the other)
    const cookieToken =
      (req.cookies && (req.cookies.accessToken || req.cookies.token)) || null;
    const authHeader =
      req.header("Authorization") || req.header("authorization") || "";
    let token = cookieToken;

    // Also accept Bearer token in Authorization header
    if (!token && authHeader.startsWith("Bearer ")) {
      token = authHeader.slice(7).trim();
    }

    // no token -> continue as guest
    if (!token) return next();

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      // avoid throwing if secret not set in env (useful in some dev setups)
      console.warn(
        "[optionalAuth] JWT_SECRET not configured, skipping token verification"
      );
      return next();
    }

    let payload;
    try {
      payload = jwt.verify(token, secret);
    } catch (err) {
      // invalid/malformed/expired token -> continue as guest (do not block)
      console.warn("[optionalAuth] token verify failed:", err.message);
      return next();
    }

    // support tokens that use either `id` or `userId` in payload
    const userId = (payload && (payload.id || payload.userId)) || null;
    if (!userId) return next();

    // best-effort user lookup, but do NOT throw or send a response on DB failure
    try {
      const user = await User.findById(userId).select(
        "username email avatarUrl role"
      );
      if (user) {
        // attach user object (mongoose document) to req.user
        req.user = user;
      }
    } catch (err) {
      console.warn("[optionalAuth] user lookup failed:", err.message);
      // proceed as guest
    }

    return next();
  } catch (err) {
    // catch-all: log and continue so route handlers still run for guests
    console.error("[optionalAuth] unexpected error:", err);
    return next();
  }
}

module.exports = optionalAuth;
