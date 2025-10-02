const express = require("express");
const router = express.Router();
const pc = require("../controllers/product.controller");

// Public browsing
router.get("/", pc.getAllProducts);
router.get("/:id", pc.getProductById);

module.exports = router;
