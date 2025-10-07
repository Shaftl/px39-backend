// server.js (simplified / pragmatic)
require("dotenv").config();
const express = require("express");
const http = require("http");
const mongoose = require("mongoose");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const cookieParser = require("cookie-parser");
const path = require("path");
const { Server } = require("socket.io");

const authRoutes = require("./routes/auth.routes");
const adminRoutes = require("./routes/admin.routes");
const publicProductRoutes = require("./routes/products.routes");

const User = require("./models/User");

const app = express();
app.set("trust proxy", 1);

// ---------- MongoDB ----------
const mongoUri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/px39";
mongoose
  .connect(mongoUri, { serverSelectionTimeoutMS: 10000 })
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

mongoose.connection.on("connected", () => console.log("mongoose: connected"));
mongoose.connection.on("error", (err) =>
  console.error("mongoose connection error:", err)
);
mongoose.connection.on("disconnected", () =>
  console.warn("mongoose: disconnected")
);

// ---------- Middleware ----------
app.use(express.json());
app.use(cookieParser());

// === VERY PERMISSIVE CORS (reflect incoming Origin and allow credentials) ===
// This purposely accepts any Origin header and reflects it back. Works well for testing and
// avoids subtle origin mismatches for vercel preview domains. Not locked-down.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Origin", origin); // reflect
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET,POST,PUT,PATCH,DELETE,OPTIONS"
    );
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type,Authorization,X-Requested-With"
    );
    if (req.method === "OPTIONS") return res.sendStatus(200);
  }
  next();
});

// Basic protections & rate limiting (kept)
app.use(helmet());
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10000,
    message: "Too many requests, please try again later.",
  })
);

// ---------- Debug helpers (optional) ----------
app.get("/debug-auth", (req, res) => {
  res.json({
    now: new Date().toISOString(),
    origin: req.get("origin") || null,
    host: req.get("host") || null,
    cookieHeader: req.get("cookie") || null,
    cookiesParsed: req.cookies || {},
    url: req.originalUrl,
    method: req.method,
    protocol: req.protocol,
    env: {
      NODE_ENV: process.env.NODE_ENV || null,
      FRONTEND_URL: process.env.FRONTEND_URL || null,
      BACKEND_URL: process.env.BACKEND_URL || null,
    },
  });
});

app.get("/debug-set-test-cookie", (req, res) => {
  const name = req.query.name || "accessToken";
  const value = "debug-" + Math.random().toString(36).slice(2, 9);
  const isProd = process.env.NODE_ENV === "production";
  const cookieOpts = {
    httpOnly: true,
    secure: isProd, // set true in production (for SameSite=None)
    sameSite: isProd ? "none" : "lax",
    maxAge: 24 * 60 * 60 * 1000,
    path: "/",
  };
  res.cookie(name, value, cookieOpts);
  res.json({ ok: true, name, value, cookieOpts });
});

// ---------- Mount routes (unchanged) ----------
app.use("/auth", authRoutes);
app.use("/admin", adminRoutes);
app.use("/products", publicProductRoutes);
app.use("/user", require("./routes/recentlyViewed.routes"));
app.use("/api/wishlist", require("./routes/wishlist.routes"));
app.use("/cart", require("./routes/cart.routes"));
app.use("/orders", require("./routes/order.routes"));
app.use("/imagekit", require("./routes/imagekit.routes"));
app.use("/push", require("./routes/push.routes"));
app.use("/contacts", require("./routes/contact.routes"));

// mount messages if file exists (non-fatal)
try {
  app.use("/messages", require("./routes/message.routes"));
} catch (e) {
  console.warn("messages route not mounted:", e.message);
}
try {
  app.use("/notifications", require("./routes/notifications.routes"));
} catch (e) {
  console.warn("notifications route not mounted:", e.message);
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ---------- Socket.IO (simple permissive CORS) ----------
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: (origin, cb) => cb(null, true),
    credentials: true,
  },
});
app.set("io", io);

// presence-tracking unchanged (kept same as you had)
const onlineUsers = new Map();
function addOnline(userId, socketId) {
  const id = String(userId);
  const set = onlineUsers.get(id) || new Set();
  set.add(socketId);
  onlineUsers.set(id, set);
}
function removeOnlineBySocket(socketId) {
  for (const [userId, set] of onlineUsers.entries()) {
    if (set.has(socketId)) {
      set.delete(socketId);
      if (set.size === 0) onlineUsers.delete(userId);
      else onlineUsers.set(userId, set);
      return userId;
    }
  }
  return null;
}
async function getOnlineUsersDetailed() {
  const ids = Array.from(onlineUsers.keys());
  if (ids.length === 0) return [];
  const users = await User.find({ _id: { $in: ids } })
    .select("username email avatarUrl role")
    .lean();
  return users.map((u) => ({
    _id: String(u._id),
    username: u.username,
    email: u.email,
    avatarUrl: u.avatarUrl || "",
    role: u.role || "user",
    sockets: onlineUsers.get(String(u._id))?.size || 0,
  }));
}

io.on("connection", (socket) => {
  console.log("socket connected:", socket.id);
  socket.on("register", async (userId) => {
    if (!userId) return;
    socket.data.userId = String(userId);
    addOnline(socket.data.userId, socket.id);
    socket.join(String(userId));
    const list = await getOnlineUsersDetailed();
    io.emit("online:update", list);
  });

  socket.on("disconnect", async () => {
    removeOnlineBySocket(socket.id);
    const list = await getOnlineUsersDetailed();
    io.emit("online:update", list);
  });
});

// ---------- Start server ----------
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});
