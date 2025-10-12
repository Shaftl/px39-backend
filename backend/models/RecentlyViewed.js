// backend/models/RecentlyViewed.js
const mongoose = require("mongoose");
const { Schema } = mongoose;

const RVItemSchema = new Schema({
  // Accept either an ObjectId (most cases) or other id strings — Mixed keeps things robust.
  productId: { type: Schema.Types.Mixed, required: true },

  name: { type: String },
  slug: { type: String },

  // price and optional sale/discount
  price: { type: Number, default: 0 },
  salePrice: { type: Number, default: null },
  discount: { type: Number, default: null },

  image: { type: String, default: "" }, // single-image for compatibility
  images: { type: [String], default: [] }, // full gallery array
  viewedAt: { type: Date, default: Date.now },
});

// Keep unique user constraint so each user has one doc
const RecentlyViewedSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
    unique: true,
  },
  items: { type: [RVItemSchema], default: [] },
});

module.exports = mongoose.model("RecentlyViewed", RecentlyViewedSchema);
