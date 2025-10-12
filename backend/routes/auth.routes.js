const express = require("express");
const router = express.Router();
const {
  register,
  verifyEmail,
  resendVerification,
  login,
  refreshToken,
  requestPasswordReset,
  resetPassword,
  logout,
  getSessions,
  requestMagicLink,
  magicLogin,

  setAvatarUrl,
  revokeSession,
  updateProfile,
  deleteAccount,
} = require("../controllers/auth.controller");
const authMiddleware = require("../middleware/auth.middleware");

// JSON parser
router.use(express.json());

// Public endpoints
router.post("/register", register);
router.post("/verify-email", verifyEmail);
router.post("/resend-verification", resendVerification);
router.post("/login", login);
router.post("/refresh", refreshToken);
router.post("/request-password-reset", requestPasswordReset);
router.post("/reset-password", resetPassword);
router.post("/logout", logout);

router.post("/magic-link-request", requestMagicLink);
router.get("/magic", magicLogin);

// Protected endpoints (must be *after* the public ones)
router.get("/me", authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

router.put("/avatar", authMiddleware, setAvatarUrl);

// **Session management** (now with authMiddleware)
router.get("/sessions", authMiddleware, getSessions);
router.delete("/sessions/:tokenId", authMiddleware, revokeSession);

// Protected endpoints
router.put("/me", authMiddleware, updateProfile); // ← new
router.delete("/me", authMiddleware, deleteAccount); // ← new

module.exports = router;
