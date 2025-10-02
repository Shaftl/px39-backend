// backend/routes/push.routes.js
const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth.middleware");
const PushSubscription = require("../models/PushSubscription");

// save or update subscription
router.post("/subscribe", auth, async (req, res) => {
  try {
    const userId = req.user._id;
    const sub = req.body.subscription;
    if (!sub) return res.status(400).json({ message: "Missing subscription" });

    const existing = await PushSubscription.findOne({
      user: userId,
      "subscription.endpoint": sub.endpoint,
    });

    if (existing) {
      existing.subscription = sub;
      await existing.save();
      return res.json({ success: true, message: "Subscription updated" });
    }

    await PushSubscription.create({ user: userId, subscription: sub });
    return res.json({ success: true });
  } catch (err) {
    console.error("POST /push/subscribe error:", err);
    return res.status(500).json({ message: "Failed to save subscription" });
  }
});

// unsubscribe (remove by endpoint)
router.post("/unsubscribe", auth, async (req, res) => {
  try {
    const userId = req.user._id;
    const { endpoint } = req.body;
    if (!endpoint) return res.status(400).json({ message: "Missing endpoint" });

    await PushSubscription.deleteMany({
      user: userId,
      "subscription.endpoint": endpoint,
    });
    return res.json({ success: true });
  } catch (err) {
    console.error("POST /push/unsubscribe error:", err);
    return res.status(500).json({ message: "Failed to unsubscribe" });
  }
});

module.exports = router;
