const Cart = require("../models/Cart");
const Product = require("../models/Product");

// Get current user’s cart (or empty)
exports.getCart = async (req, res) => {
  const userId = req.user._id;
  let cart = await Cart.findOne({ user: userId }).populate("items.product");
  if (!cart) cart = { items: [] };
  res.json(cart);
};

// Add/update an item
exports.addToCart = async (req, res) => {
  const userId = req.user._id;
  const { productId, color, size, quantity } = req.body;
  // validate product exists
  const prod = await Product.findById(productId);
  if (!prod) return res.status(404).json({ message: "Product not found" });

  let cart = await Cart.findOne({ user: userId });
  if (!cart) cart = new Cart({ user: userId, items: [] });

  const existing = cart.items.find(
    (i) => i.product.equals(productId) && i.color === color && i.size === size
  );

  if (existing) {
    existing.quantity = Math.max(1, existing.quantity + quantity);
  } else {
    cart.items.push({ product: productId, color, size, quantity });
  }

  await cart.save();
  await cart.populate("items.product");
  res.json(cart);
};

// Update an item's quantity (or remove if quantity <= 0)
exports.updateCartItem = async (req, res) => {
  const userId = req.user._id;
  const { index } = req.params;
  const { quantity } = req.body;

  const cart = await Cart.findOne({ user: userId });
  if (!cart) return res.status(404).json({ message: "Cart not found" });

  const idx = parseInt(index, 10);
  if (isNaN(idx) || idx < 0 || idx >= cart.items.length) {
    return res.status(400).json({ message: "Invalid item index" });
  }

  const q = Number(quantity);
  if (isNaN(q)) {
    return res.status(400).json({ message: "Invalid quantity" });
  }

  if (q <= 0) {
    // remove the item
    cart.items.splice(idx, 1);
  } else {
    cart.items[idx].quantity = Math.max(1, q);
  }

  await cart.save();
  await cart.populate("items.product");
  res.json(cart);
};

// Remove an item
exports.removeFromCart = async (req, res) => {
  const userId = req.user._id;
  const { index } = req.params;
  const cart = await Cart.findOne({ user: userId });
  if (!cart) return res.status(404).json({ message: "Cart not found" });

  cart.items.splice(index, 1);
  await cart.save();
  await cart.populate("items.product");
  res.json(cart);
};

// Clear entire cart
exports.clearCart = async (req, res) => {
  const userId = req.user._id;
  await Cart.findOneAndDelete({ user: userId });
  res.json({ message: "Cart cleared" });
};
