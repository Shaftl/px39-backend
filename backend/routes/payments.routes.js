// backend/routes/payments.routes.js
const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth.middleware");
const paymentsController = require("../controllers/payments.controller");

// Only authenticated users can call fake payment
router.post("/fake", auth, paymentsController.fakePayment);

module.exports = router;
