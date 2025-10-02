const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth.middleware");
const cc = require("../controllers/cart.controller");

router.use(auth);
router.get("/", cc.getCart);
router.post("/", cc.addToCart);
router.patch("/:index", cc.updateCartItem);
router.delete("/:index", cc.removeFromCart);
router.delete("/", cc.clearCart);

module.exports = router;
