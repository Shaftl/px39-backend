// backend/routes/auth.routes.js
const express = require("express");
const router = express.Router();

// try requiring controller; if it throws, capture and continue with an empty object
let authController = {};
try {
  authController = require("../controllers/auth.controller") || {};
} catch (err) {
  console.warn(
    "auth.routes: failed to require ../controllers/auth.controller — continuing with fallbacks. Error:",
    err && err.message
  );
  authController = {};
}

/**
 * ensureHandler(fn, name)
 * - returns fn when it's a function
 * - otherwise returns a fallback handler that responds 500 and logs a useful message
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

// list expected handlers (names must match controller exports)
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

const authMiddleware = (() => {
  try {
    return require("../middleware/auth.middleware");
  } catch (err) {
    // fallback middleware that returns 500 if auth.middleware is missing
    console.warn(
      "auth.routes: failed to require auth.middleware — requests using auth will fail. Error:",
      err && err.message
    );
    return (req, res, next) =>
      res
        .status(500)
        .json({ message: "Server misconfiguration: auth middleware missing." });
  }
})();

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

// **Session management**
router.get("/sessions", authMiddleware, getSessions);
router.delete("/sessions/:tokenId", authMiddleware, revokeSession);

// Protected profile endpoints
router.put("/me", authMiddleware, updateProfile);
router.delete("/me", authMiddleware, deleteAccount);

module.exports = router;
