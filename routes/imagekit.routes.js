// backend/routes/imagekit.routes.js
const express = require("express");
const ImageKit = require("imagekit");
const fetch = require("node-fetch"); // safe for Node <18; if Node>=18 you may remove this line
const authMiddleware = require("../middleware/auth.middleware");
// const Product = require("../models/Product"); // uncomment if you want server-side saving

const router = express.Router();

const imagekit = new ImageKit({
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT,
});

/**
 * Authenticated endpoint (unchanged behavior)
 */
router.get("/auth", authMiddleware, (req, res) => {
  try {
    const result = imagekit.getAuthenticationParameters();
    return res.json(result);
  } catch (err) {
    console.error("GET /imagekit/auth error:", err);
    return res.status(500).json({ error: "failed to create auth params" });
  }
});

/**
 * Public fallback endpoint (new)
 *
 * Purpose: deployed frontend sometimes cannot send auth cookie across origins;
 * this endpoint returns ImageKit auth parameters without requiring the auth cookie.
 *
 * SECURITY: by default it's open. If you want minimal protection set
 * IMAGEKIT_PUBLIC_AUTH_KEY in backend env and callers must send header:
 *   x-imagekit-key: <IMAGEKIT_PUBLIC_AUTH_KEY>
 */
router.get("/auth-public", (req, res) => {
  try {
    if (process.env.IMAGEKIT_PUBLIC_AUTH_KEY) {
      const incoming = req.header("x-imagekit-key");
      if (!incoming || incoming !== process.env.IMAGEKIT_PUBLIC_AUTH_KEY) {
        return res.status(403).json({ error: "forbidden" });
      }
    }

    const result = imagekit.getAuthenticationParameters();
    return res.json(result);
  } catch (err) {
    console.error("GET /imagekit/auth-public error:", err);
    return res.status(500).json({ error: "failed to create auth params" });
  }
});

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

    const r = await fetch(tinyUrl);
    if (!r.ok)
      return res.status(502).json({ error: "failed to fetch tiny image" });

    const arr = await r.arrayBuffer();
    const buf = Buffer.from(arr);
    const mime = r.headers.get("content-type") || "image/webp";
    const base64 = buf.toString("base64");
    const blurDataURL = `data:${mime};base64,${base64}`;

    // optional server-side save commented out (keeps your original logic)
    /*
    if (productId) {
      try {
        const p = await Product.findById(productId);
        if (p) {
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
