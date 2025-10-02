// backend/routes/recentlyViewed.routes.js
const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth.middleware");
const controller = require("../controllers/recentlyViewed.controller");

// POST /user/recently-viewed  { product: { _id, name, price, image, slug }, limit? }
// requires auth
router.post("/recently-viewed", auth, controller.addOrUpdate);

// GET /user/recently-viewed
router.get("/recently-viewed", auth, controller.getForUser);

module.exports = router;
