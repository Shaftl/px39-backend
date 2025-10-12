const express = require("express");
const router = express.Router();
const {
  createContact,
  createContactValidators,
  listContacts,
  markRead,
  deleteContact,
  replyContact,
} = require("../controllers/contact.controller");
const authMiddleware = require("../middleware/auth.middleware");
const permitRoles = require("../middleware/role.middleware");
const optionalAuth = require("../middleware/optionalAuth.middleware");

// PUBLIC create: attach req.user when cookie/token present but do not require auth
router.post("/", optionalAuth, createContactValidators, createContact);

// admin routes (protected)
router.get("/", authMiddleware, permitRoles("admin"), listContacts);
router.patch("/:id/read", authMiddleware, permitRoles("admin"), markRead);
router.post("/:id/reply", authMiddleware, permitRoles("admin"), replyContact);
router.delete("/:id", authMiddleware, permitRoles("admin"), deleteContact);

module.exports = router;
