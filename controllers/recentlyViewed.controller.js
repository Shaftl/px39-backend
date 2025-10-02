// backend/controllers/recentlyViewed.controller.js
const RecentlyViewed = require("../models/RecentlyViewed");
const mongoose = require("mongoose");

// limit how many items to keep per user
const DEFAULT_LIMIT = 20;

exports.addOrUpdate = async (req, res) => {
  try {
    const userId = req.user && req.user._id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const product = req.body && req.body.product;
    if (!product || !product._id) {
      console.warn("recentlyViewed.addOrUpdate invalid body:", {
        body: req.body,
      });
      return res.status(400).json({
        message:
          "Missing product (expecting { product: { _id, name, price, image, images, slug, salePrice, discount } })",
      });
    }

    console.debug("recentlyViewed.addOrUpdate request product summary:", {
      productId: String(product._id).slice(0, 24),
      name: product.name,
      hasImages: Array.isArray(product.images)
        ? product.images.length
        : !!product.image,
      salePrice: product.salePrice ?? null,
      discount: product.discount ?? null,
    });

    // determine productId safely (preserve ObjectId when valid)
    let productIdValue = product._id;
    try {
      if (mongoose.isValidObjectId(productIdValue)) {
        productIdValue = new mongoose.Types.ObjectId(String(productIdValue));
      } else {
        // keep as-is (schema accepts Mixed)
      }
    } catch (err) {
      productIdValue = product._id;
    }

    // Normalize images array if provided
    const imagesFromRequest =
      (Array.isArray(product.images) && product.images.filter(Boolean)) ||
      (product.image ? [product.image] : []) ||
      [];

    // price numeric
    const price =
      typeof product.price === "number"
        ? product.price
        : product.price
        ? Number(product.price)
        : 0;

    // salePrice numeric if provided
    const salePrice =
      typeof product.salePrice === "number"
        ? product.salePrice
        : product.salePrice
        ? Number(product.salePrice)
        : null;

    // discount numeric if provided, otherwise compute (best-effort)
    let discount = null;
    if (typeof product.discount === "number") {
      discount = product.discount;
    } else if (product.discount) {
      const parsed = Number(product.discount);
      if (!Number.isNaN(parsed)) discount = parsed;
    } else if (salePrice && price > 0 && salePrice < price) {
      discount = Math.round(((price - salePrice) / price) * 100);
    }

    const snapshot = {
      productId: productIdValue,
      name: product.name || "",
      slug: product.slug || "",
      price,
      salePrice: salePrice ?? null,
      discount: discount ?? null,
      image: product.image || imagesFromRequest[0] || "",
      images: imagesFromRequest,
      viewedAt: new Date(),
    };

    const limit = Number(req.body.limit) || DEFAULT_LIMIT;

    // ---------- Atomic update using aggregation pipeline (MongoDB >= 4.2) ----------
    // Use stringified comparison so we dedupe regardless of stored type (ObjectId vs string)
    try {
      const snapshotIdStr = String(snapshot.productId);

      const updated = await RecentlyViewed.findOneAndUpdate(
        { user: userId },
        [
          {
            $set: {
              items: {
                $concatArrays: [
                  [snapshot],
                  {
                    // SAFE: if $items is null/absent, treat as empty array so filter/slice behave
                    $filter: {
                      input: { $ifNull: ["$items", []] },
                      as: "it",
                      cond: {
                        $ne: [{ $toString: "$$it.productId" }, snapshotIdStr],
                      },
                    },
                  },
                ],
              },
            },
          },
          {
            $set: {
              items: { $slice: ["$items", limit] },
            },
          },
        ],
        {
          new: true, // return updated doc
          upsert: true,
        }
      ).lean();

      // Normal successful path: items is an array
      if (updated && Array.isArray(updated.items)) {
        return res.json({ items: updated.items });
      }

      // If updated exists but items ended up null/invalid (very rare), repair it:
      if (updated) {
        // If Mongo gave us a non-array, coerce to a safe array (prefer what came back if array-like)
        const repaired = Array.isArray(updated.items)
          ? updated.items
          : [snapshot];
        // Ensure it's trimmed to `limit`
        const finalItems = repaired.slice(0, limit);
        try {
          await RecentlyViewed.updateOne(
            { user: userId },
            { $set: { items: finalItems } }
          );
        } catch (uErr) {
          console.warn(
            "Failed to repair recentlyViewed.items after pipeline:",
            uErr && uErr.message
          );
        }
        return res.json({ items: finalItems });
      }

      // fallback: create doc if somehow missing (shouldn't usually run because upsert:true)
      const created = await RecentlyViewed.findOneAndUpdate(
        { user: userId },
        { $setOnInsert: { user: userId, items: [snapshot] } },
        { upsert: true, new: true }
      ).lean();
      return res.json({ items: (created && created.items) || [] });
    } catch (pipeErr) {
      console.warn(
        "Aggregation-pipeline update failed, falling back to safe retry:",
        pipeErr && pipeErr.message
      );

      try {
        // remove existing entries for this productId (cover both ObjectId & string)
        await RecentlyViewed.updateOne(
          { user: userId },
          { $pull: { items: { productId: snapshot.productId } } }
        );

        await RecentlyViewed.updateOne(
          { user: userId },
          { $pull: { items: { productId: String(snapshot.productId) } } }
        );

        // push snapshot to front
        await RecentlyViewed.updateOne(
          { user: userId },
          { $push: { items: { $each: [snapshot], $position: 0 } } },
          { upsert: true }
        );

        // fetch then trim to limit (finalize)
        const doc = await RecentlyViewed.findOne({ user: userId }).lean();
        if (doc) {
          const items = Array.isArray(doc.items)
            ? doc.items.slice(0, limit)
            : [];
          await RecentlyViewed.updateOne({ user: userId }, { $set: { items } });
          return res.json({ items });
        }

        return res.json({ items: [] });
      } catch (fallbackErr) {
        console.error("addOrUpdate recently viewed fallback error:", {
          message: fallbackErr && fallbackErr.message,
          stack:
            fallbackErr && fallbackErr.stack
              ? fallbackErr.stack.split("\n").slice(0, 6).join("\n")
              : undefined,
          bodyPreview:
            req && req.body
              ? {
                  product: req.body.product && {
                    _id: req.body.product._id,
                    name: req.body.product.name,
                  },
                }
              : undefined,
        });
        return res
          .status(500)
          .json({ message: "Server error while adding recently viewed" });
      }
    }
  } catch (err) {
    console.error("addOrUpdate recently viewed error:", {
      message: err && err.message,
      stack:
        err && err.stack
          ? err.stack.split("\n").slice(0, 6).join("\n")
          : undefined,
      bodyPreview:
        req && req.body
          ? {
              product: req.body.product && {
                _id: req.body.product._id,
                name: req.body.product.name,
              },
            }
          : undefined,
    });
    return res
      .status(500)
      .json({ message: "Server error while adding recently viewed" });
  }
};

exports.getForUser = async (req, res) => {
  try {
    const userId = req.user && req.user._id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const doc = await RecentlyViewed.findOne({ user: userId }).lean();
    return res.json({ items: (doc && doc.items) || [] });
  } catch (err) {
    console.error("getForUser recently viewed error", err);
    return res.status(500).json({ message: err.message });
  }
};
