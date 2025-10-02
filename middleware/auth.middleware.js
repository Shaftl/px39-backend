// backend/middleware/auth.middleware.js

const jwt = require("jsonwebtoken");
const User = require("../models/User");

async function authMiddleware(req, res, next) {
  try {
    // 1. Read token from cookie
    const token = req.cookies.accessToken;
    if (!token) {
      return res.status(401).json({ message: "Access token missing." });
    }

    // 2. Verify token
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    // 3. Attach user info to request
    const user = await User.findById(payload.userId).select("-passwordHash");
    if (!user || user.status !== "active") {
      return res.status(401).json({ message: "Invalid or inactive user." });
    }

    req.user = user; // full user doc (minus password)
    next();
  } catch (err) {
    console.error("Auth middleware error:", err);
    return res.status(401).json({ message: "Invalid or expired token." });
  }
}

module.exports = authMiddleware;
