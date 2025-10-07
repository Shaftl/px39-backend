// backend/routes/auth.routes.js
const express = require("express");
const router = express.Router();

// require the controller module as a whole (safer for detecting missing exports)
const authController = require("../controllers/auth.controller") || {};

/**
 * Helper: return the real handler if it's a function,
 * otherwise return a fallback that responds 500 and log a warning.
 */
function ensureHandler(fn, name) {
  if (typeof fn === "function") return fn;
  console.warn(
    `auth.routes: handler "${name}" is missing or not a function — using fallback responder`
  );
  return (req, res) =>
    res
      .status(500)
      .json({
        message: `Server misconfiguration: auth handler "${name}" unavailable.`,
      });
}

// pick handlers (these names are the ones routes expect)
const register = ensureHandler(authController.register, "register");
const verifyEmail = ensureHandler(authController.verifyEmail, "verifyEmail");
const resendVerification = ensureHandler(
  authController.resendVerification,
  "resendVerification"
);
const login = ensureHandler(authController.login, "login");
const refreshToken = ensureHandler(authController.refreshToken, "refreshToken");
const requestPasswordReset = ensureHandler(
  authController.requestPasswordReset,
  "requestPasswordReset"
);
const resetPassword = ensureHandler(
  authController.resetPassword,
  "resetPassword"
);
const logout = ensureHandler(authController.logout, "logout");
const getSessions = ensureHandler(authController.getSessions, "getSessions");
const requestMagicLink = ensureHandler(
  authController.requestMagicLink,
  "requestMagicLink"
);
const magicLogin = ensureHandler(authController.magicLogin, "magicLogin");
const setAvatarUrl = ensureHandler(authController.setAvatarUrl, "setAvatarUrl");
const revokeSession = ensureHandler(
  authController.revokeSession,
  "revokeSession"
);
const updateProfile = ensureHandler(
  authController.updateProfile,
  "updateProfile"
);
const deleteAccount = ensureHandler(
  authController.deleteAccount,
  "deleteAccount"
);

const authMiddleware = require("../middleware/auth.middleware");

// JSON parser for this router
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

// Session management
router.get("/sessions", authMiddleware, getSessions);
router.delete("/sessions/:tokenId", authMiddleware, revokeSession);

// Protected endpoints
router.put("/me", authMiddleware, updateProfile);
router.delete("/me", authMiddleware, deleteAccount);

module.exports = router;
