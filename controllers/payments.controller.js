// backend/controllers/payments.controller.js
const Order = require("../models/Order");
const Product = require("../models/Product");
const nc = require("./notification.controller");
const mongoose = require("mongoose");

/** escape user-provided regex text safely */
function escapeRegExp(string = "") {
  return String(string || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Best-effort restock helper (same logic as order cancellation)
 */
async function restockOrderItems(order) {
  for (const it of order.items || []) {
    try {
      const prodId = it.product;
      const color = (it.color || "").toString().trim();
      const size = (it.size || "").toString().trim();
      const qty = Number(it.quantity) || 0;
      if (!prodId || !size || qty <= 0) continue;

      const colorRegex = new RegExp(`^${escapeRegExp(color)}$`, "i");

      await Product.updateOne(
        { _id: prodId, variations: { $elemMatch: { color: colorRegex } } },
        { $inc: { [`variations.$.stockBySize.${size}`]: qty } }
      ).exec();
    } catch (e) {
      console.warn("restockOrderItems error:", e && e.message ? e.message : e);
    }
  }
}

/**
 * POST /payments/fake
 * Body: { orderId: string, simulate: 'success' | 'fail', card?: { last4, name } }
 */
async function fakePayment(req, res) {
  try {
    const userId = req.user && req.user._id;
    if (!userId) return res.status(401).json({ message: "Not authenticated" });

    const { orderId, simulate, card } = req.body || {};
    if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ message: "Invalid orderId" });
    }

    const order = await Order.findById(orderId).populate(
      "user",
      "username email"
    );
    if (!order) return res.status(404).json({ message: "Order not found" });

    // Only the order owner or admin may call this endpoint to pay
    const isOwner = String(order.user._id) === String(userId);
    const isAdmin = req.user && req.user.role === "admin";
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ message: "Forbidden" });
    }

    // If already marked payed, return current order (idempotent)
    if (order.payed) {
      return res.status(200).json({ message: "Already payed", order });
    }

    // Simulate success
    if (simulate === "success") {
      order.payed = true;
      order.meta = order.meta || {};
      order.meta.payment = {
        provider: "fake",
        transactionId: `FAKE-${Date.now()}`,
        last4: card?.last4 || null,
        paidAt: new Date(),
        paidBy: userId,
      };
      // keep fulfillment status as-is (likely 'pending')
      await order.save();

      // notify user
      try {
        await nc.createAndEmitNotification({
          req,
          userId: order.user._id,
          type: "order",
          title: "Payment received",
          body: `Payment for order ${order._id} received.`,
          data: { orderId: String(order._id), payed: true },
        });
      } catch (e) {
        console.warn("notify user after fake pay failed:", e && e.message);
      }

      return res.json({ ok: true, order });
    }

    // Simulate failure -> cancel order and restock
    order.payed = false;
    order.status = "cancelled";
    order.meta = order.meta || {};
    order.meta.payment = {
      provider: "fake",
      transactionId: null,
      last4: card?.last4 || null,
      failedAt: new Date(),
      reason: "simulated_failure",
      paidBy: userId,
    };
    await order.save();

    // Attempt restock
    try {
      await restockOrderItems(order);
    } catch (e) {
      console.warn("Failed restocking after simulated payment failure:", e);
    }

    try {
      await nc.createAndEmitNotification({
        req,
        userId: order.user._id,
        type: "order",
        title: "Payment failed — order cancelled",
        body: `Payment for order ${order._id} failed. Order cancelled and items restocked.`,
        data: { orderId: String(order._id), status: "cancelled" },
      });
    } catch (e) {
      console.warn("notify user after fake fail failed:", e && e.message);
    }

    return res
      .status(400)
      .json({ ok: false, message: "Simulated payment failure", order });
  } catch (err) {
    console.error("fakePayment error:", err && (err.stack || err));
    return res
      .status(500)
      .json({ message: "Payment simulation failed", error: err?.message });
  }
}

module.exports = {
  fakePayment,
};
