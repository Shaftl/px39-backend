const Order = require("../models/Order");
const Product = require("../models/Product");
const nc = require("./notification.controller");
const mongoose = require("mongoose");
const Joi = require("joi");
const { parsePhoneNumberFromString } = require("libphonenumber-js");
const User = require("../models/User"); // <-- ADDED: used to notify admins

/** escape user-provided regex text safely */
function escapeRegExp(string = "") {
  return string.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&");
}

/**
 * Joi schemas for request validation
 */
const shippingJoi = Joi.object({
  fullName: Joi.string().min(2).max(200).required(),
  phone: Joi.string().required(),
  country: Joi.string().min(2).max(100).required(),
  state: Joi.string().allow("", null),
  city: Joi.string().min(2).max(100).required(),
  postalCode: Joi.string().allow("", null, "N/A").max(20),
  addressLine1: Joi.string().min(3).max(300).required(),
  addressLine2: Joi.string().allow("", null).max(300),
  notes: Joi.string().allow("", null).max(2000),
}).required();

const itemJoi = Joi.object({
  product: Joi.alternatives()
    .try(Joi.string().regex(/^[0-9a-fA-F]{24}$/), Joi.any())
    .optional(),
  productId: Joi.any().optional(), // in case frontend uses productId key
  name: Joi.string().allow("", null).max(500).required(),
  color: Joi.string().allow("", null).max(200),
  size: Joi.string().allow("", null).max(50),
  quantity: Joi.number().integer().min(1).required(),
  price: Joi.number().precision(2).min(0).required(),
  image: Joi.string().allow("", null),
}).required();

const createOrderJoi = Joi.object({
  items: Joi.array().items(itemJoi).min(1).required(),
  totalPrice: Joi.number().precision(2).min(0).required(),
  shipping: shippingJoi.optional(),
  idempotencyKey: Joi.string().allow("", null).max(500),
  fingerprint: Joi.string().allow("", null), // optional client fingerprint
}).required();

/**
 * Validate phone number using libphonenumber-js
 */
function isValidPhone(phone, country) {
  try {
    const pn = parsePhoneNumberFromString(
      String(phone || ""),
      country || undefined
    );
    return !!(pn && pn.isValid());
  } catch (e) {
    return false;
  }
}

/**
 * Recalculate total price server-side from DB products.
 * Returns integer cents.
 *
 * Logic: prefer variation.salePrice -> variation.price -> product.salePrice -> product.price -> client-provided price
 */
async function recalcTotalPriceCents(items) {
  let totalCents = 0;
  for (const it of items) {
    const qty = Number(it.quantity) || 1;
    let unitPrice = null;

    const prodId = it.product || it.productId;
    if (prodId) {
      // fetch product to get authoritative price (supports variations if present)
      const p = await Product.findById(prodId).lean();
      if (!p) {
        throw new Error(`Product not found: ${prodId}`);
      }

      // Attempt to find matching variation by color (case-insensitive)
      let variation = null;
      if (Array.isArray(p.variations) && (it.color || "")) {
        const colorRegex = new RegExp(
          `^${escapeRegExp((it.color || "").toString())}$`,
          "i"
        );
        variation = p.variations.find((v) => {
          try {
            return colorRegex.test(String(v.color || ""));
          } catch (e) {
            return false;
          }
        });
      }

      // Prefer variation.salePrice -> variation.price -> product.salePrice -> product.price -> client price
      if (variation) {
        if (typeof variation.salePrice === "number") {
          unitPrice = Number(variation.salePrice);
        } else if (typeof variation.price === "number") {
          unitPrice = Number(variation.price);
        }
      }

      if (unitPrice === null) {
        if (typeof p.salePrice === "number") {
          unitPrice = Number(p.salePrice);
        } else if (typeof p.price === "number") {
          unitPrice = Number(p.price);
        } else if (it.price) {
          unitPrice = Number(it.price);
        } else {
          throw new Error(`Price missing for product ${prodId}`);
        }
      }
    } else {
      // Non-product fallback: use provided price (e.g., gift card)
      unitPrice = Number(it.price || 0);
    }

    if (!Number.isFinite(unitPrice)) unitPrice = 0;

    // convert to cents and multiply by quantity
    const unitCents = Math.round(unitPrice * 100);
    totalCents += unitCents * qty;
  }
  return totalCents;
}

/**
 * Minimal server-side shipping validation fallback
 * (kept for compatibility but main validation is Joi + phone)
 */
function validateShippingMinimal(shipping = {}) {
  const required = ["fullName", "phone", "country", "city", "addressLine1"];
  const missing = required.filter(
    (k) => !shipping[k] || !String(shipping[k]).trim()
  );
  if (missing.length) return { ok: false, missing };
  return { ok: true };
}

/**
 * POST /orders
 */
async function createOrder(req, res) {
  try {
    const userId = req.user && req.user._id;
    if (!userId) return res.status(401).json({ message: "Not authenticated" });

    // Validate body shape with Joi
    const { error, value } = createOrderJoi.validate(req.body, {
      abortEarly: false,
    });
    if (error) {
      return res.status(400).json({
        message: "Invalid payload",
        details: error.details.map((d) => d.message),
      });
    }
    const {
      items,
      totalPrice,
      shipping: shippingBody,
      idempotencyKey,
      fingerprint,
    } = value;

    // Phone validation (prefer the shipping country if provided)
    const shippingCandidate =
      shippingBody && typeof shippingBody === "object" ? shippingBody : {};
    if (!isValidPhone(shippingCandidate.phone, shippingCandidate.country)) {
      // fallback: check minimally with original validator
      const sv = validateShippingMinimal(shippingCandidate);
      if (!sv.ok) {
        return res.status(400).json({
          message: `Missing shipping fields: ${sv.missing.join(", ")}`,
        });
      }
      return res.status(400).json({ message: "Phone number appears invalid." });
    }

    // Idempotency: if key provided, return existing order for this user
    const key =
      idempotencyKey ||
      req.headers["idempotency-key"] ||
      req.headers["Idempotency-Key"];
    if (key) {
      const existing = await Order.findOne({
        idempotencyKey: key,
        user: userId,
      }).lean();
      if (existing) {
        return res.status(200).json({ order: existing });
      }
    }

    // Recalculate total price from DB (in cents)
    let calcCents;
    try {
      calcCents = await recalcTotalPriceCents(items);
    } catch (e) {
      return res
        .status(400)
        .json({ message: e.message || "Error recalculating total price" });
    }

    // Compare with submitted totalPrice (convert to cents)
    const submittedCents = Math.round(Number(totalPrice) * 100);
    if (isNaN(submittedCents) || submittedCents !== calcCents) {
      return res.status(400).json({
        message: "totalPrice mismatch",
        expected: (calcCents / 100).toFixed(2),
        provided:
          typeof totalPrice === "number"
            ? totalPrice.toFixed
              ? totalPrice.toFixed(2)
              : totalPrice
            : totalPrice,
      });
    }

    // Build shipping info: prefer body.shipping, fallback to req.user snapshot (as before)
    let shippingInfo =
      shippingBody && typeof shippingBody === "object" ? shippingBody : {};
    if ((!shippingInfo || Object.keys(shippingInfo).length === 0) && req.user) {
      shippingInfo = {
        fullName: req.user.fullName || req.user.username || "",
        phone: req.user.phone || "",
        country: req.user.country || "",
        state: req.user.state || "",
        city: req.user.city || "",
        postalCode: req.user.postalCode || "",
        addressLine1: req.user.addressLine1 || "",
        addressLine2: req.user.addressLine2 || "",
        notes: "",
      };
    }

    // Server-side validate shipping again (Joi already validated shape if passed earlier)
    const sv = validateShippingMinimal(shippingInfo);
    if (!sv.ok) {
      return res
        .status(400)
        .json({ message: `Missing shipping fields: ${sv.missing.join(", ")}` });
    }

    const processedItems = [];
    const decremented = []; // track successful decrements to rollback if needed

    // For each item attempt an atomic decrement on product variation's stock
    for (const it of items) {
      const quantity = Number(it.quantity) || 1;
      const price = Number(it.price) || 0;
      const name = it.name || "";
      const image = it.image || "";
      const color = (it.color || "").toString().trim();
      const size = (it.size || "").toString().trim();

      const prodId = it.product || it.productId;
      if (prodId) {
        // Build query to match product AND a variation with matching color (case-insensitive)
        // and sufficient stock for the requested size.
        const colorRegex = new RegExp(`^${escapeRegExp(color)}$`, "i");

        const elemMatch = {
          color: colorRegex,
        };
        // dynamic stock path for size inside variation
        elemMatch[`stockBySize.${size}`] = { $gte: quantity };

        const query = { _id: prodId, variations: { $elemMatch: elemMatch } };

        // dynamic update path to decrement that size
        const update = {
          $inc: { [`variations.$.stockBySize.${size}`]: -quantity },
        };

        const result = await Product.updateOne(query, update).exec();

        // result.matchedCount / modifiedCount used to determine success
        if (
          !result ||
          result.matchedCount === 0 ||
          result.modifiedCount === 0
        ) {
          // rollback prior decrements (best-effort)
          for (const d of decremented) {
            try {
              const dColorRegex = new RegExp(`^${escapeRegExp(d.color)}$`, "i");
              await Product.updateOne(
                {
                  _id: d.prodId,
                  variations: { $elemMatch: { color: dColorRegex } },
                },
                { $inc: { [`variations.$.stockBySize.${d.size}`]: d.qty } }
              ).exec();
            } catch (e) {
              console.error(
                "Rollback failed for",
                d,
                e && e.stack ? e.stack : e
              );
            }
          }

          return res.status(400).json({
            message: `Not enough stock or selected variation missing for product ${prodId}, color="${color}", size="${size}".`,
          });
        }

        // record successful decrement so we can revert if needed later
        decremented.push({ prodId, color, size, qty: quantity });
      }

      processedItems.push({
        product: prodId || undefined,
        name,
        color,
        size,
        quantity,
        price,
        image,
      });
    }

    // Build order doc
    const orderDoc = {
      user: userId,
      contactSnapshot: {
        email: req.user?.email,
        username: req.user?.username,
      },
      shipping: shippingInfo,
      items: processedItems,
      totalPrice: Number((calcCents / 100).toFixed(2)),
      status: "pending",
      meta: {
        ip: req.ip || (req.headers["x-forwarded-for"] || "").split(",")[0],
        userAgent: req.get("User-Agent") || "",
        fingerprint: fingerprint || null,
      },
    };

    if (key) orderDoc.idempotencyKey = key;

    // Create order document (all stock updates already applied)
    const order = await Order.create(orderDoc);

    // Create + emit notification to user
    try {
      await nc.createAndEmitNotification({
        req,
        userId,
        type: "order",
        title: "Order placed",
        body: `Your order ${order._id} was placed successfully.`,
        data: { orderId: String(order._id) },
      });
    } catch (notifyErr) {
      console.warn(
        "create order: failed to notify user:",
        notifyErr && (notifyErr.stack || notifyErr)
      );
    }

    // --- NEW: Notify all admins about the new order (fire-and-forget) ---
    try {
      const admins = await User.find({ role: "admin" })
        .select("_id username email")
        .lean();
      if (admins && admins.length) {
        const who = req.user?.username || req.user?.email || String(userId);
        const notifyPromises = admins.map((a) =>
          nc
            .createAndEmitNotification({
              req,
              userId: a._id,
              type: "order",
              title: "New order placed",
              body: `Order ${order._id} placed by ${who}.`,
              data: {
                orderId: String(order._id),
                url: `/admin/dashboard/orders/${order._id}`,
              },
            })
            .catch((e) => {
              console.warn(
                `Failed to notify admin ${a._id}:`,
                e && e.message ? e.message : e
              );
            })
        );
        // run in background — don't block the checkout response
        Promise.all(notifyPromises).catch(() => {});
      }
    } catch (adminNotifyErr) {
      console.warn("Failed to find/notify admins:", adminNotifyErr);
    }

    return res.status(201).json({ order });
  } catch (err) {
    console.error("createOrder error:", err && err.stack ? err.stack : err);
    return res.status(500).json({
      message: "Could not create order.",
      error: err?.message || String(err),
    });
  }
}

/**
 * GET /orders/my
 */
async function getMyOrders(req, res) {
  try {
    const orders = await Order.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .populate("items.product", "name")
      .lean();
    return res.json({ orders });
  } catch (err) {
    console.error("Get orders error:", err);
    return res.status(500).json({ message: "Server error fetching orders." });
  }
}

/**
 * Admin: GET /admin/orders
 */
async function getAllOrders(req, res) {
  try {
    const limit = Math.min(parseInt(req.query.limit || "100", 10), 1000);
    const orders = await Order.find({})
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate("user", "username email")
      .populate("items.product", "name")
      .lean();
    return res.json({ orders });
  } catch (err) {
    console.error("Admin get orders error:", err);
    return res.status(500).json({ message: "Server error fetching orders." });
  }
}

async function getOrderById(req, res) {
  try {
    const { id } = req.params;

    // find by id, populate common fields (adjust population targets to your schema)
    const order = await Order.findById(id)
      .populate("user", "username email avatarUrl")
      // if items store product refs:
      .populate({
        path: "items.product",
        select: "title slug price",
      })
      .lean();

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    return res.json({ order });
  } catch (err) {
    console.error("GET /admin/dashboard/orders/:id error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}

/**
 * Admin: PATCH /admin/dashboard/orders/:id/status
 *
 * - If new status === "cancelled" and previous status !== "cancelled",
 *   increment stock back for each order item that references a product.
 * - Uses atomic updateOne increments per product/variation size (no transactions),
 *   and logs errors but continues where possible.
 */
async function updateOrderStatus(req, res) {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid order id" });
    }

    // NOTE: "paid" removed — payment is tracked via order.payed boolean now
    const validStatuses = ["pending", "shipped", "delivered", "cancelled"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const order = await Order.findById(id).populate("user", "username email");
    if (!order) return res.status(404).json({ message: "Order not found" });

    const previousStatus = order.status;

    // If we're moving into 'cancelled' and it wasn't cancelled already, restock items
    if (status === "cancelled" && previousStatus !== "cancelled") {
      // best-effort: increment the stock for each item that has a product reference
      for (const it of order.items || []) {
        try {
          const prodId = it.product;
          const color = (it.color || "").toString().trim();
          const size = (it.size || "").toString().trim();
          const qty = Number(it.quantity) || 0;

          if (!prodId || !size || qty <= 0) continue;

          const colorRegex = new RegExp(`^${escapeRegExp(color)}$`, "i");

          // increment the matching variation's stockBySize[size] by qty
          const updateRes = await Product.updateOne(
            { _id: prodId, variations: { $elemMatch: { color: colorRegex } } },
            { $inc: { [`variations.$.stockBySize.${size}`]: qty } }
          ).exec();

          if (!updateRes || updateRes.modifiedCount === 0) {
            console.warn(
              `Restock: could not increment stock for product ${prodId}, color="${color}", size="${size}" — product/variation not found`
            );
          }
        } catch (e) {
          console.error(
            "Error restocking item on cancel:",
            e && e.stack ? e.stack : e
          );
        }
      }
    }

    // update the status (fulfillment lifecycle)
    order.status = status;
    await order.save();

    // Build notification title based on new status values (no "paid" here)
    let title =
      status === "shipped"
        ? "Order shipped"
        : status === "delivered"
        ? "Order delivered"
        : status === "cancelled"
        ? "Order cancelled"
        : "Order status updated";

    try {
      await nc.createAndEmitNotification({
        req,
        userId: order.user._id,
        type: "order",
        title,
        body: `Your order ${order._id} is now "${status}".`,
        data: { orderId: String(order._id), status },
      });
    } catch (notifyErr) {
      console.warn(
        "Failed to create/emit order notification:",
        notifyErr && (notifyErr.stack || notifyErr)
      );
    }

    const updated = await Order.findById(id)
      .populate("user", "username email")
      .populate("items.product", "name")
      .lean();

    return res.json({ order: updated });
  } catch (err) {
    console.error("Update order status error:", err);
    return res.status(500).json({ message: "Could not update order status." });
  }
}

module.exports = {
  createOrder,
  getMyOrders,
  getAllOrders,
  getOrderById,
  updateOrderStatus,
};
