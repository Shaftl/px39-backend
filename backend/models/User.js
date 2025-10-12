const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      enum: ["user", "admin", "moderator"],
      default: "user",
    },
    status: {
      type: String,
      enum: ["active", "banned", "deleted"],
      default: "active",
    },

    // store the previous status (optional) so admin unban can restore it
    previousStatus: {
      type: String,
      enum: ["active", "banned", "deleted"],
      required: false,
    },

    emailVerified: {
      type: Boolean,
      default: false,
    },
    verificationToken: String,
    verificationTokenExpiry: Date,
    // Optional: track devices/sessions (we’ll add later)
    lastVerificationSent: Date,

    resetPasswordToken: String,
    resetPasswordExpiry: Date,
    sessions: [
      {
        tokenId: String,
        createdAt: { type: Date, default: Date.now },
        ip: String,
        browser: String,
        os: String,
        device: String,
      },
    ],

    magicLinkToken: String,
    magicLinkExpiry: Date,

    avatarUrl: {
      type: String,
      default:
        "https://ik.imagekit.io/ehggwul6k/avatars/150fa8800b0a0d5633abc1d1c4db3d87_ez-lfcXam.jpg",
    },

    wishlist: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }],
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
