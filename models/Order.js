// backend/models/Order.js
const mongoose = require("mongoose");

const shippingSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true },
    phone: { type: String, required: true },
    country: { type: String, required: true },
    state: { type: String },
    city: { type: String, required: true },
    postalCode: { type: String },
    addressLine1: { type: String, required: true },
    addressLine2: { type: String },
    notes: { type: String },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    // snapshot of user contact info at time of order (non-sensitive)
    contactSnapshot: {
      email: String,
      username: String,
    },

    // shipping contact (stored with order)
    shipping: shippingSchema,

    items: [
      {
        product: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
        name: String,
        color: String,
        size: String,
        quantity: Number,
        price: Number,
        image: String,
      },
    ],

    // money stored as decimal-like Number (dollars)
    totalPrice: { type: Number, required: true },

    // fulfillment status (no more "paid" here)
    status: {
      type: String,
      enum: ["pending", "shipped", "delivered", "cancelled"],
      default: "pending",
    },

    // new: was the order paid?
    payed: { type: Boolean, default: false },

    // idempotency: optional unique key per user to prevent duplicate orders
    idempotencyKey: { type: String, index: true, sparse: true },

    // metadata for fraud analysis / logging
    meta: {
      ip: String,
      userAgent: String,
      fingerprint: String,
      countryFromIP: String,
      payment: {
        provider: String,
        transactionId: String,
        last4: String,
        paidAt: Date,
        failedAt: Date,
        reason: String,
        paidBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      },
      // add more as needed
    },
  },
  { timestamps: true }
);

// optional: index for quicker admin listing by payed + status
orderSchema.index({ payed: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model("Order", orderSchema);
