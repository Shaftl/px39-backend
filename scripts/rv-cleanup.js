// scripts/rv-cleanup.js
require("dotenv").config();
const mongoose = require("mongoose");
const RecentlyViewed = require("../models/RecentlyViewed");
const Product = require("../models/Product");

const mongoUri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/px39";

async function main() {
  await mongoose.connect(mongoUri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  console.log("Connected to mongo for RV cleanup");

  const allDocs = await RecentlyViewed.find({}).lean();
  console.log(`Scanning ${allDocs.length} RecentlyViewed docs...`);

  let totalRemoved = 0;
  for (const doc of allDocs) {
    if (!Array.isArray(doc.items) || doc.items.length === 0) continue;

    const ids = Array.from(
      new Set(doc.items.map((it) => String(it.productId)))
    );
    // find which ids actually exist
    const existing = await Product.find({ _id: { $in: ids } })
      .select("_id")
      .lean();
    const existingSet = new Set(existing.map((p) => String(p._id)));

    const cleaned = doc.items.filter((it) =>
      existingSet.has(String(it.productId))
    );

    if (cleaned.length !== doc.items.length) {
      totalRemoved += doc.items.length - cleaned.length;
      await RecentlyViewed.updateOne(
        { _id: doc._id },
        { $set: { items: cleaned } }
      );
      console.log(
        `Cleaned doc ${doc._id}: removed ${
          doc.items.length - cleaned.length
        } stale items`
      );
    }
  }

  console.log(`Done. total removed items: ${totalRemoved}`);
  await mongoose.disconnect();
  console.log("Disconnected");
}

main().catch((err) => {
  console.error("Cleanup error", err);
  process.exit(1);
});
