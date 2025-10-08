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
 * Utility: set CORS allow-origin to requesting origin (only if present)
 * This is an extra safety-net for environments where proxy strips CORS.
 */
function setAllowOriginIfPresent(req, res) {
  try {
    const origin = req.get("origin");
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }
  } catch (e) {
    // ignore
  }
}

/**
 * Helper: obtain a fetch implementation.
 * - Prefer global fetch (Node 18+ / Node 22).
 * - If not present, dynamically import node-fetch (only when needed).
 *   This avoids a hard crash at require-time on hosts that don't have node-fetch.
 */
async function getFetch() {
  if (typeof fetch !== "undefined") return fetch;
  try {
    const mod = await import("node-fetch");
    // node-fetch v3 uses default export
    return mod.default || mod;
  } catch (err) {
    // bubble a clear error for callers
    throw new Error(
      "No fetch available. Install 'node-fetch' or run on Node 18+. Dynamic import failed: " +
        err.message
    );
  }
}

/**
 * Authenticated endpoint
 */
router.get("/auth", authMiddleware, (req, res) => {
  try {
    setAllowOriginIfPresent(req, res);
    const result = imagekit.getAuthenticationParameters();
    return res.json(result);
  } catch (err) {
    console.error("GET /imagekit/auth error:", err);
    return res.status(500).json({ error: "failed to create auth params" });
  }
});

/**
 * Public (no-auth) endpoint.
 * This allows the frontend to fetch ImageKit auth parameters without requiring
 * a logged-in session (useful for public uploads or when credentials/cookies
 * aren't available). This mirrors the authenticated /auth response but does
 * not require auth middleware.
 */
router.get("/auth-public", (req, res) => {
  try {
    setAllowOriginIfPresent(req, res);
    const result = imagekit.getAuthenticationParameters();
    return res.json(result);
  } catch (err) {
    console.error("GET /imagekit/auth-public error:", err);
    return res
      .status(500)
      .json({ error: "failed to create auth params (public)" });
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

    // Request very small optimized image from ImageKit (16px width)
    const tinyUrl = `${imageKitUrl}?tr=w-16,fo-auto,fl-lossy,f-webp,q-40`;

    // get a fetch implementation (global or dynamic)
    let fetchImpl;
    try {
      fetchImpl = await getFetch();
    } catch (err) {
      console.error("generate-blur fetch error:", err);
      return res.status(500).json({
        error:
          "Server does not have a fetch implementation. Install 'node-fetch' or run on Node 18+. ",
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

    return res.json({ blurDataURL });
  } catch (err) {
    console.error("generate-blur error:", err);
    return res.status(500).json({ error: "server error" });
  }
});

module.exports = router;
