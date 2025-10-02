// backend/routes/message.routes.js
const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth.middleware");
const mc = require("../controllers/message.controller");

// All routes require auth
router.use(auth);

// List conversations for current user
router.get("/", mc.getConversations);

// Get messages in a conversation
router.get("/:id", mc.getMessages);

// Mark conversation seen
router.post("/:id/seen", mc.markConversationSeen);

// Reply in a conversation
router.post("/:id/reply", mc.replyToConversation);

// Like / unlike a message (toggle)
router.post("/message/:id/like", mc.toggleLikeMessage);

module.exports = router;
