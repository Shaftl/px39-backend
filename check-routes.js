// check-routes.js
const paths = [
  "./routes/auth.routes",
  "./routes/admin.routes",
  "./routes/products.routes",
  "./routes/recentlyViewed.routes",
  "./routes/wishlist.routes",
  "./routes/cart.routes",
  "./routes/order.routes",
  "./routes/imagekit.routes",
  "./routes/push.routes",
  "./routes/contact.routes",
  "./routes/payments.routes",
  "./routes/message.routes",
  "./routes/notifications.routes",
];

paths.forEach((p) => {
  try {
    require(p);
    console.log("OK:", p);
  } catch (err) {
    console.error("ERROR requiring", p);
    console.error(err && err.stack ? err.stack : err);
  }
});
