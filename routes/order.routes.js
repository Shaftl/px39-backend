// backend/routes/order.routes.js
const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth.middleware");
const oc = require("../controllers/order.controller");

// Create order (checkout)
router.post("/", auth, oc.createOrder);

// Get current user's orders
router.get("/my", auth, oc.getMyOrders);

module.exports = router;
