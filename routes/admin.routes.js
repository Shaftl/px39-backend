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

// --- TEMP DEBUG ROUTES (paste directly under app.use(cookieParser()); ) ---
app.get("/debug-auth", (req, res) => {
  try {
    const info = {
      now: new Date().toISOString(),
      originHeader: req.get("origin") || null,
      hostHeader: req.get("host") || null,
      referrer: req.get("referer") || req.get("referrer") || null,
      cookieHeader: req.get("cookie") || null,
      cookiesParsed: req.cookies || {},
      hasAccessTokenCookie: !!(
        req.cookies &&
        (req.cookies.accessToken || req.cookies.token)
      ),
      authorizationHeader: req.get("authorization") || null,
      remoteIp:
        req.ip || (req.connection && req.connection.remoteAddress) || null,
      url: req.originalUrl,
      method: req.method,
      protocol: req.protocol,
      env: {
        NODE_ENV: process.env.NODE_ENV || null,
        FRONTEND_URL: process.env.FRONTEND_URL || null,
        FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN || null,
        BACKEND_URL: process.env.BACKEND_URL || null,
      },
      corsAllowed: (() => {
        const origin = req.get("origin");
        if (!origin) return null;
        try {
          // re-run same originAllowed logic lightly (best-effort)
          const allowed = (() => {
            const allowedOrigins = new Set([
              process.env.FRONTEND_URL,
              process.env.FRONTEND_ORIGIN,
              "http://localhost:3000",
              "http://127.0.0.1:3000",
            ]);
            if (allowedOrigins.has(origin)) return true;
            try {
              const u = new URL(origin);
              const hostname = u.hostname.toLowerCase();
              const projectSlug = "px39-test-final";
              if (
                hostname.endsWith(".vercel.app") &&
                hostname.includes(projectSlug)
              )
                return true;
            } catch (e) {}
            return false;
          })();
          return allowed;
        } catch (e) {
          return null;
        }
      })(),
    };
    return res.json(info);
  } catch (err) {
    console.error("DEBUG /debug-auth error:", err);
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

// quick helper to set a test cookie using same production options (temporary)
// GET /debug-set-test-cookie?name=foo
app.get("/debug-set-test-cookie", (req, res) => {
  const name = req.query.name || "testToken";
  const value = "debug-" + Math.random().toString(36).slice(2, 9);
  const isProd = process.env.NODE_ENV === "production";
  const cookieOpts = {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    maxAge: 24 * 60 * 60 * 1000,
    path: "/",
  };
  res.cookie(name, value, cookieOpts);
  return res.json({ ok: true, name, value, cookieOpts });
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
