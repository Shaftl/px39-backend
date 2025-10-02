const Product = require("../models/Product");
const RecentlyViewed = require("../models/RecentlyViewed");
const Cart = require("../models/Cart");
const User = require("../models/User"); // <-- NEW: remove product from user.wishlist
const mongoose = require("mongoose");

// helper: normalize tags input (array or string "a,b; c")
const normalizeTags = (input) => {
  if (!input) return [];
  if (Array.isArray(input)) {
    return Array.from(
      new Set(input.map((t) => String(t || "").trim()).filter(Boolean))
    );
  }
  return Array.from(
    new Set(
      String(input)
        .split(/[;,]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    )
  );
};

// ─── Admin: Create ─────────────────────────────────────────────────────────────
exports.createProduct = async (req, res) => {
  try {
    const body = req.body || {};

    // normalize tags (accept array or comma/semicolon separated string)
    const tags = normalizeTags(body.tags);

    const prod = new Product({
      ...body,
      tags,
    });

    await prod.save();
    res.status(201).json(prod);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// ─── Public/Admin: Read all with filters & pagination ───────────────────────────
exports.getAllProducts = async (req, res) => {
  try {
    const {
      category,
      minPrice,
      maxPrice,
      size,
      color,
      search,
      page = 1,
      limit = 20,
      includeHidden, // optional override via query ?includeHidden=true
      tag, // <-- support ?tag=featured
    } = req.query;

    const filter = {};

    if (category) {
      filter.category = category;
    }
    if (search) {
      filter.name = { $regex: search, $options: "i" };
    }
    if (minPrice || maxPrice) {
      filter.price = {};
      if (minPrice) filter.price.$gte = Number(minPrice);
      if (maxPrice) filter.price.$lte = Number(maxPrice);
    }
    if (size) {
      filter.sizes = size;
    }
    if (color) {
      filter.variations = {
        $elemMatch: {
          color: { $regex: `^${color}$`, $options: "i" },
        },
      };
    }

    // filter by tag (case-insensitive exact match)
    if (tag) {
      filter.tags = { $in: [new RegExp(`^${tag}$`, "i")] };
    }

    // Visibility: by default public consumers should NOT see hidden products.
    // Admin routes should see hidden products. We detect admin route by checking
    // if the request URL includes "/admin" OR if includeHidden=true is explicitly passed.
    const forcedIncludeHidden = includeHidden === "true";
    const isAdminRoute = req.originalUrl && req.originalUrl.includes("/admin");

    if (!isAdminRoute && !forcedIncludeHidden) {
      // for public routes, only return not-hidden products
      filter.hidden = false;
    }
    // If admin route or includeHidden=true, we do not add filter.hidden so hidden items are included.

    const skip = (Number(page) - 1) * Number(limit);

    const [items, total] = await Promise.all([
      Product.find(filter)
        .skip(skip)
        .limit(Number(limit))
        .sort({ createdAt: -1 }),
      Product.countDocuments(filter),
    ]);

    res.json({
      items,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── Public/Admin: Read one ─────────────────────────────────────────────────────
exports.getProductById = async (req, res) => {
  try {
    const prod = await Product.findById(req.params.id);
    if (!prod) return res.status(404).json({ message: "Not found" });

    // If the product is hidden and the request is NOT for an admin route and includeHidden isn't set,
    // treat as not found for public consumers.
    const { includeHidden } = req.query;
    const isAdminRoute = req.originalUrl && req.originalUrl.includes("/admin");
    const forcedIncludeHidden = includeHidden === "true";
    if (prod.hidden && !isAdminRoute && !forcedIncludeHidden) {
      return res.status(404).json({ message: "Not found" });
    }

    res.json(prod);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// ─── Admin: Update ─────────────────────────────────────────────────────────────
exports.updateProduct = async (req, res) => {
  try {
    const body = { ...(req.body || {}) };

    // Normalize tags if provided
    if (typeof body.tags !== "undefined") {
      body.tags = normalizeTags(body.tags);
    }

    const prod = await Product.findByIdAndUpdate(
      req.params.id,
      { ...body, updatedAt: Date.now() },
      { new: true, runValidators: true }
    );
    if (!prod) return res.status(404).json({ message: "Not found" });

    // ---- NEW: if product is now hidden, remove references from RecentlyViewed, Cart, and Wishlist ----
    // This makes hidden products behave like deleted ones across user data.
    try {
      if (prod.hidden) {
        const oid = prod._id;

        // Remove from RecentlyViewed (ObjectId + string fallback)
        await RecentlyViewed.updateMany(
          {},
          { $pull: { items: { productId: oid } } }
        );
        await RecentlyViewed.updateMany(
          {},
          { $pull: { items: { productId: String(oid) } } }
        );

        // Remove from Cart items (product field is ObjectId ref). Also try string-fallback.
        try {
          await Cart.updateMany({}, { $pull: { items: { product: oid } } });
          await Cart.updateMany(
            {},
            { $pull: { items: { product: String(oid) } } }
          );
          // optional: delete carts that become empty
          // await Cart.deleteMany({ items: { $size: 0 } });
        } catch (cartErr) {
          console.warn(
            "Failed to remove product from carts after hiding product:",
            cartErr && cartErr.message
          );
        }

        // Remove from all users' wishlist (ObjectId + string fallback)
        try {
          await User.updateMany({}, { $pull: { wishlist: oid } });
          await User.updateMany({}, { $pull: { wishlist: String(oid) } });
        } catch (wishErr) {
          console.warn(
            "Failed to remove product from wishlists after hiding product:",
            wishErr && wishErr.message
          );
        }

        // emit same event clients expect (harmless if io not set)
        const io = req.app && req.app.get && req.app.get("io");
        const payload = { productId: String(oid) };
        if (io && typeof io.emit === "function") {
          try {
            io.emit("recentlyViewed:productDeleted", payload);
            io.emit("cart:productRemoved", payload);
            io.emit("wishlist:productRemoved", payload);
          } catch (emitErr) {
            // non-fatal
            console.warn(
              "emit recentlyViewed/cart/wishlist event failed:",
              emitErr && emitErr.message
            );
          }
        }
      }
    } catch (rvErr) {
      // log but do not fail update operation
      console.error("Failed to clean references after hiding product:", {
        message: rvErr && rvErr.message,
        stack:
          rvErr && rvErr.stack
            ? rvErr.stack.split("\n").slice(0, 6).join("\n")
            : undefined,
        productId: String(prod._id),
      });
    }
    // ------------------------------------------------------------------------------

    res.json(prod);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// ─── Admin: Delete ─────────────────────────────────────────────────────────────
exports.deleteProduct = async (req, res) => {
  try {
    const prod = await Product.findByIdAndDelete(req.params.id);
    if (!prod) return res.status(404).json({ message: "Not found" });

    // Remove references from RecentlyViewed for all users.
    // We try both ObjectId and string forms because RV may store productId as ObjectId or string.
    try {
      const oid = prod._id;
      // pull entries where productId equals ObjectId
      await RecentlyViewed.updateMany(
        {},
        { $pull: { items: { productId: oid } } }
      );
      // pull entries where productId equals string id (fallback)
      await RecentlyViewed.updateMany(
        {},
        { $pull: { items: { productId: String(oid) } } }
      );

      // Remove from carts as well
      try {
        await Cart.updateMany({}, { $pull: { items: { product: oid } } });
        await Cart.updateMany(
          {},
          { $pull: { items: { product: String(oid) } } }
        );
        // optionally: delete carts that became empty
        // await Cart.deleteMany({ items: { $size: 0 } });
      } catch (cartErr) {
        console.error(
          "Failed to remove product references from carts after delete:",
          cartErr && cartErr.message
        );
      }

      // Remove from all users' wishlist
      try {
        await User.updateMany({}, { $pull: { wishlist: oid } });
        await User.updateMany({}, { $pull: { wishlist: String(oid) } });
      } catch (wishErr) {
        console.error(
          "Failed to remove product references from wishlists after delete:",
          wishErr && wishErr.message
        );
      }

      // optionally: remove RecentlyViewed docs that became empty (comment/uncomment as desired)
      // await RecentlyViewed.deleteMany({ items: { $size: 0 } });

      // emit a lightweight event so clients can remove the product from UI in realtime (clients must listen)
      const io = req.app && req.app.get && req.app.get("io");
      if (
        io &&
        (typeof io.emit === "function" || typeof io.emitToUser === "function")
      ) {
        try {
          // broadcast productId as string
          const payload = { productId: String(prod._id) };
          // prefer generic emit (clients can listen on 'recentlyViewed:productDeleted')
          if (typeof io.emit === "function")
            io.emit("recentlyViewed:productDeleted", payload);
          // also let clients know cart and wishlist items were removed
          if (typeof io.emit === "function")
            io.emit("cart:productRemoved", payload);
          if (typeof io.emit === "function")
            io.emit("wishlist:productRemoved", payload);
          // also call emitToUser if available (no harm)
          if (typeof io.emitToUser === "function")
            io.emitToUser(null, "recentlyViewed:productDeleted", payload);
          if (typeof io.emitToUser === "function")
            io.emitToUser(null, "cart:productRemoved", payload);
          if (typeof io.emitToUser === "function")
            io.emitToUser(null, "wishlist:productRemoved", payload);
        } catch (emitErr) {
          // non-fatal
          console.warn(
            "emit recentlyViewed/cart/wishlist productDeleted failed:",
            emitErr && emitErr.message
          );
        }
      }
    } catch (rvErr) {
      // log but don't fail the delete operation
      console.error(
        "Failed to clean RecentlyViewed references for deleted product:",
        {
          message: rvErr && rvErr.message,
          stack:
            rvErr && rvErr.stack
              ? rvErr.stack.split("\n").slice(0, 6).join("\n")
              : undefined,
          productId: String(prod._id),
        }
      );
    }

    res.json({ message: "Deleted" });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};
