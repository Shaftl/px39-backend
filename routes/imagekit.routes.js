// backend/routes/imagekit.routes.js
const express = require("express");
const ImageKit = require("imagekit");
const authMiddleware = require("../middleware/auth.middleware");
// const Product = require("../models/Product"); // uncomment if you want server-side saving

const router = express.Router();

const imagekit = new ImageKit({
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT,
});

/**
 * Helper: get a fetch implementation.
 * - Use global fetch if available (Node 18+ / Node 22 has it).
 * - Otherwise attempt dynamic import of 'node-fetch' (only if installed).
 *   If that also fails, handler will return 500 and explain the missing dependency.
 */
async function getFetch() {
  if (typeof fetch !== "undefined") return fetch;
  // dynamic import only when needed (so module load doesn't throw)
  try {
    const mod = await import("node-fetch");
    // node-fetch v3 default export is the function
    return mod.default || mod;
  } catch (err) {
    // rethrow to be handled by caller
    throw new Error(
      "No fetch available. Install 'node-fetch' or use Node 18+. Dynamic import failed: " +
        err.message
    );
  }
}

router.get(
  "/auth",
  authMiddleware,
  /* permitRoles("admin"), */ (req, res) => {
    const result = imagekit.getAuthenticationParameters();
    res.json(result);
  }
);

/**
 * POST /imagekit/generate-blur
 * body: { imageKitUrl: string, productId?: string, imageIndex?: number }
 * Returns: { blurDataURL: 'data:image/xxx;base64,...' }
 */
router.post("/generate-blur", authMiddleware, async (req, res) => {
  try {
    const { imageKitUrl, productId, imageIndex } = req.body;
    if (!imageKitUrl)
      return res.status(400).json({ error: "imageKitUrl required" });

    const tinyUrl = `${imageKitUrl}?tr=w-16,fo-auto,fl-lossy,f-webp,q-40`;

    // get fetch implementation (global or dynamic)
    let fetchImpl;
    try {
      fetchImpl = await getFetch();
    } catch (err) {
      console.error("generate-blur fetch error:", err);
      return res.status(500).json({
        error:
          "Server does not have a fetch implementation. Install 'node-fetch' or run on Node 18+.",
      });
    }

    const r = await fetchImpl(tinyUrl);
    if (!r.ok)
      return res.status(502).json({ error: "failed to fetch tiny image" });

    const arr = await r.arrayBuffer();
    const buf = Buffer.from(arr);
    const mime = r.headers.get("content-type") || "image/webp";
    const base64 = buf.toString("base64");
    const blurDataURL = `data:${mime};base64,${base64}`;

    // Optional: store blurDataURL into product doc on server-side (recommended for production)
    /*
    if (productId) {
      try {
        const p = await Product.findById(productId);
        if (p) {
          // adapt to your schema: here we assume variations[0].lqips is an array aligning with images
          p.variations = p.variations || [];
          const v = p.variations[0] || {};
          v.lqips = v.lqips || [];
          if (typeof imageIndex === "number") v.lqips[imageIndex] = blurDataURL;
          else v.lqips.push(blurDataURL);
          p.variations[0] = v;
          await p.save();
        }
      } catch (e) {
        console.warn("Failed to save blurDataURL to product:", e.message);
      }
    }
    */

    return res.json({ blurDataURL });
  } catch (err) {
    console.error("generate-blur error:", err);
    return res.status(500).json({ error: "server error" });
  }
});

module.exports = router;
