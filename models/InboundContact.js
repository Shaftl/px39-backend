// backend/models/InboundContact.js
const mongoose = require("mongoose");

const inboundContactSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    phone: { type: String, default: "" },
    message: { type: String, required: true },
    ip: { type: String, default: "" },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    read: { type: Boolean, default: false },
    archived: { type: Boolean, default: false },
    meta: { type: Object, default: {} }, // extra metadata if needed
  },
  { timestamps: true }
);

module.exports = mongoose.model("InboundContact", inboundContactSchema);
