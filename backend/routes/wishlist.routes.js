const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth.middleware");
const wc = require("../controllers/wishlist.controller");

// All endpoints require a valid, logged-in user
router.use(auth);

router
  .get("/", wc.getWishlist) // GET  /api/wishlist
  .post("/:productId", wc.addToWishlist) // POST /api/wishlist/:productId
  .delete("/:productId", wc.removeFromWishlist); // DELETE /api/wishlist/:productId

module.exports = router;
