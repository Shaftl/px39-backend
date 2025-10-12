const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/auth.middleware");
const permitRoles = require("../middleware/role.middleware");
const productController = require("../controllers/product.controller");
const orderController = require("../controllers/order.controller");
const messageController = require("../controllers/message.controller");

// ensure the models are required near top:
const User = require("../models/User");
const Order = require("../models/Order");
const Product = require("../models/Product");
const Cart = require("../models/Cart");

// Protect all admin routes
router.use(authMiddleware, permitRoles("admin"));

// Admin dashboard (example)
router.get("/dashboard", (req, res) => {
  res.json({ message: "Welcome, Admin!", user: req.user });
});

/**
 * Admin stats summary endpoint
 * GET /admin/stats
 */
router.get("/stats", async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalProducts = await Product.countDocuments();
    const totalOrders = await Order.countDocuments();
    const totalCarts = await Cart.countDocuments();

    const recentOrders = await Order.find({})
      .sort({ createdAt: -1 })
      .limit(10)
      .populate("user", "username email avatarUrl")
      .lean();

    const statusAgg = await Order.aggregate([
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);

    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const monthly = await Order.aggregate([
      { $match: { createdAt: { $gte: sixMonthsAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } },
          revenue: { $sum: { $ifNull: ["$totalPrice", 0] } },
          ordersCount: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    return res.json({
      totalUsers,
      totalProducts,
      totalOrders,
      totalCarts,
      recentOrders,
      statusDistribution: statusAgg,
      monthly,
    });
  } catch (err) {
    console.error("GET /admin/stats error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// Admin: orders listing + status update
router.get("/orders", orderController.getAllOrders);
router.patch("/orders/:id/status", orderController.updateOrderStatus);
// Admin: send a message to a user
router.post("/messages", messageController.adminSendMessage);

// ─── Admin: orders listing + status update ────────────────────────────────────

// NEW: get single order by id
router.get("/orders/:id", orderController.getOrderById);

/**
 * GET /admin/users
 * returns list of users (without password)
 */
router.get("/users", async (req, res) => {
  try {
    const users = await User.find({})
      .select("-passwordHash -password -resetToken -refreshTokens")
      .sort({ createdAt: -1 })
      .lean();
    res.json(users);
  } catch (err) {
    console.error("GET /admin/users error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * PATCH /admin/users/:id/block
 * mark user as banned (status = "banned") and store previousStatus
 */
router.patch("/users/:id/block", async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ error: "Not found" });

    if (user.role === "admin") {
      return res.status(403).json({ error: "Cannot block admin users" });
    }

    // Save previous status only if we are not already banned
    if (user.status !== "banned") {
      user.previousStatus = user.status;
    }
    user.status = "banned";
    await user.save();

    const safe = await User.findById(id).select("-passwordHash -password");
    console.log(
      `Admin ${req.user._id} banned user ${id} (prev: ${user.previousStatus})`
    );
    res.json(safe);
  } catch (err) {
    console.error("PATCH /admin/users/:id/block error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * PATCH /admin/users/:id/unblock
 * restore user.status from previousStatus (if present) or use "active"
 */
router.patch("/users/:id/unblock", async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ error: "Not found" });

    // Restore previousStatus if it exists, otherwise default to 'active'
    const restore = user.previousStatus || "active";
    user.status = restore;
    // clear previousStatus after restore
    user.previousStatus = undefined;
    await user.save();

    const safe = await User.findById(id).select("-passwordHash -password");
    console.log(
      `Admin ${req.user._id} unbanned user ${id} (restored: ${restore})`
    );
    res.json(safe);
  } catch (err) {
    console.error("PATCH /admin/users/:id/unblock error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * DELETE /admin/users/:id
 * deletes a user unless they are admin
 */
router.delete("/users/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ error: "Not found" });
    if (user.role === "admin") {
      return res.status(403).json({ error: "Cannot delete admin users" });
    }
    await User.findByIdAndDelete(id);
    res.json({ success: true });
  } catch (err) {
    console.error("DELETE /admin/users/:id error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─── Product Management (unchanged) ───────────────────────────────────────────
router.post("/products", productController.createProduct);
router.get("/products", productController.getAllProducts);
router.get("/products/:id", productController.getProductById);
router.put("/products/:id", productController.updateProduct);
router.delete("/products/:id", productController.deleteProduct);

module.exports = router;
