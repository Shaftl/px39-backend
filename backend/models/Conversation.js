// backend/models/Conversation.js
const mongoose = require("mongoose");

const conversationSchema = new mongoose.Schema(
  {
    participants: [
      { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    ],
    subject: { type: String, trim: true },
    lastMessageAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// index for quick lookups
conversationSchema.index({ participants: 1, lastMessageAt: -1 });

module.exports = mongoose.model("Conversation", conversationSchema);
