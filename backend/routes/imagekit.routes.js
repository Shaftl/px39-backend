const express = require("express");
const ImageKit = require("imagekit");
const fetch = require("node-fetch");
const authMiddleware = require("../middleware/auth.middleware");

const router = express.Router();

const imagekit = new ImageKit({
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT,
});

// 🔓 Public route: no auth required
router.get("/auth", (req, res) => {
  const result = imagekit.getAuthenticationParameters();
  res.json(result);
});

// 🔒 Still protected
router.post("/generate-blur", authMiddleware, async (req, res) => {
  try {
    const { imageKitUrl } = req.body;
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

    return res.json({ blurDataURL });
  } catch (err) {
    console.error("generate-blur error:", err);
    return res.status(500).json({ error: "server error" });
  }
});

module.exports = router;
