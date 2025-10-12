// backend/models/Notification.js
const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: { type: String, required: true }, // e.g. 'order'
    title: { type: String, required: true },
    body: { type: String, default: "" },
    data: { type: mongoose.Schema.Types.Mixed, default: {} }, // arbitrary JSON
    read: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

// helpful compound index
notificationSchema.index({ user: 1, read: 1, createdAt: -1 });

module.exports = mongoose.model("Notification", notificationSchema);
