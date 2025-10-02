const mongoose = require("mongoose");

// variation sub-schema (unchanged structure)
const variationSchema = new mongoose.Schema({
  color: { type: String, required: true },
  images: [String], // URLs
  stockBySize: {
    // e.g. { S: 10, M: 5, L: 0 }
    XS: Number,
    S: Number,
    M: Number,
    L: Number,
    XL: Number,
  },
});

// helper: compute sale price given inputs
function computeSalePrice(
  price,
  discount,
  discountType,
  discountActive,
  discountExpires
) {
  const p = Number(price || 0);
  const d = Number(discount || 0);

  // if discount not active or not positive, return base price
  if (!discountActive || d <= 0) return Number(p.toFixed(2));

  // if expiry provided and it's in the past, ignore discount
  if (discountExpires) {
    const ex = new Date(discountExpires);
    if (isNaN(ex.getTime()) || ex.getTime() <= Date.now()) {
      return Number(p.toFixed(2));
    }
  }

  if (discountType === "fixed") {
    const sp = p - d;
    return Number(Math.max(0, sp).toFixed(2));
  }

  // percent
  const sp = p * (1 - d / 100);
  return Number(Math.max(0, sp).toFixed(2));
}

const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String, required: true },
  price: { type: Number, required: true },
  category: { type: String, required: true }, // e.g. "Clothes"/"Shoes"
  sizes: [String], // ["XS","S","M","L","XL"]
  variations: [variationSchema],
  tags: { type: [String], default: [] },
  hidden: { type: Boolean, default: false },

  // --- Discount fields (new) ---
  discount: { type: Number, default: 0 }, // percent (e.g. 20) or fixed amount depending on discountType
  discountType: {
    type: String,
    enum: ["percent", "fixed"],
    default: "percent",
  },
  discountActive: { type: Boolean, default: false },
  discountExpires: { type: Date, default: null },

  // persisted computed sale price (always present; equals price when no active discount)
  salePrice: { type: Number, default: null },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// recalc helper on instance
productSchema.methods.recalculateSalePrice = function () {
  this.salePrice = computeSalePrice(
    this.price,
    this.discount,
    this.discountType,
    this.discountActive,
    this.discountExpires
  );
  return this.salePrice;
};

// ensure salePrice updated on save (create & save)
productSchema.pre("save", function (next) {
  // recalc if new or relevant fields changed
  if (
    this.isNew ||
    this.isModified("price") ||
    this.isModified("discount") ||
    this.isModified("discountType") ||
    this.isModified("discountActive") ||
    this.isModified("discountExpires")
  ) {
    this.recalculateSalePrice();
  } else if (this.salePrice == null) {
    // ensure not null
    this.recalculateSalePrice();
  }

  this.updatedAt = Date.now();
  next();
});

// when using findByIdAndUpdate / findOneAndUpdate, modify the update to include salePrice
// (findByIdAndUpdate uses findOneAndUpdate under the hood)
productSchema.pre("findOneAndUpdate", async function (next) {
  try {
    const update = this.getUpdate();
    if (!update) return next();

    // normalise to $set
    const set = update.$set ? { ...update.$set } : { ...update };

    // fetch current document to merge values (so we can compute with existing fields when not provided in update)
    const doc = await this.model.findOne(this.getQuery()).lean();

    // merged values: doc values overridden by set values
    const merged = Object.assign({}, doc || {}, set || {});

    // compute salePrice using merged values
    const sp = computeSalePrice(
      Number(merged.price || 0),
      Number(merged.discount || 0),
      merged.discountType || "percent",
      !!merged.discountActive,
      merged.discountExpires || null
    );

    // ensure $set exists and add salePrice + updatedAt
    if (!update.$set) update.$set = {};
    update.$set.salePrice = sp;
    update.$set.updatedAt = new Date();

    // replace update
    this.setUpdate(update);
    return next();
  } catch (err) {
    return next(err);
  }
});

// virtual to compute total stock across all variations (unchanged)
productSchema.virtual("totalStock").get(function () {
  if (!this.variations || !this.variations.length) return 0;
  return this.variations.reduce((acc, v) => {
    const vals = v?.stockBySize ? Object.values(v.stockBySize) : [];
    const s = vals.reduce((a, b) => a + (Number(b) || 0), 0);
    return acc + s;
  }, 0);
});

// ensure virtuals are included when converting to JSON / objects
productSchema.set("toJSON", { virtuals: true });
productSchema.set("toObject", { virtuals: true });

module.exports = mongoose.model("Product", productSchema);
