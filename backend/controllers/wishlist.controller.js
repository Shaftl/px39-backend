const User = require("../models/User");
const Product = require("../models/Product");

exports.getWishlist = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).populate("wishlist").lean();
    return res.json(user.wishlist);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Could not fetch wishlist." });
  }
};

exports.addToWishlist = async (req, res) => {
  try {
    const { productId } = req.params;
    const user = await User.findById(req.user._id);
    if (!user.wishlist.includes(productId)) {
      user.wishlist.push(productId);
      await user.save();
    }
    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Could not add to wishlist." });
  }
};

exports.removeFromWishlist = async (req, res) => {
  try {
    const { productId } = req.params;
    await User.findByIdAndUpdate(req.user._id, {
      $pull: { wishlist: productId },
    });
    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Could not remove from wishlist." });
  }
};
