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

// IMPORTANT: behind a proxy (Render, etc.)
app.set("trust proxy", 1);

// Normalize frontend origins (remove trailing slashes)
const FRONTEND_ORIGIN = (
  process.env.FRONTEND_ORIGIN || "https://px39-frontend-test-1.onrender.com"
).replace(/\/+$/, "");
const FRONTEND_URL = (process.env.FRONTEND_URL || FRONTEND_ORIGIN).replace(
  /\/+$/,
  ""
);

// Optional project slug used for allowing vercel preview domains
const PROJECT_SLUG = process.env.PROJECT_SLUG || "px39";

// ——————— 1. Connect to MongoDB ———————
const mongoUri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/px39";
const mongooseOptions = { serverSelectionTimeoutMS: 10000 };

mongoose
  .connect(mongoUri, mongooseOptions)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

mongoose.connection.on("connected", () => console.log("mongoose: connected"));
mongoose.connection.on("error", (err) =>
  console.error("mongoose connection error:", err)
);
mongoose.connection.on("disconnected", () =>
  console.warn("mongoose: disconnected")
);

// ——————— 2. Global Middleware ———————
app.use(express.json());
app.use(cookieParser());

// ====== START: robust CORS for multiple origins ======
const allowedOrigins = new Set([
  FRONTEND_URL,
  FRONTEND_ORIGIN,
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

function originAllowed(origin) {
  if (!origin) return true; // allow server-to-server or curl without Origin
  if (allowedOrigins.has(origin)) return true;
  try {
    const u = new URL(origin);
    const hostname = u.hostname.toLowerCase();
    if (hostname.endsWith(".vercel.app") && hostname.includes(PROJECT_SLUG)) {
      return true;
    }
    return false;
  } catch (e) {
    return false;
  }
}

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!origin) return next();

  if (originAllowed(origin)) {
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET,POST,PUT,PATCH,DELETE,OPTIONS"
    );
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type,Authorization,X-Requested-With"
    );
    console.log(`CORS: allowed origin ${origin} for ${req.method} ${req.url}`);
    if (req.method === "OPTIONS") return res.sendStatus(200);
    return next();
  } else {
    console.warn(`CORS: blocked origin ${origin} for ${req.method} ${req.url}`);
    return res.status(403).json({ error: "CORS origin not allowed" });
  }
});
// ====== END CORS ======

app.use(helmet());
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10000,
    message: "Too many requests, please try again later.",
  })
);

// ——————— 3. Mount routes ———————
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
app.use("/payments", require("./routes/payments.routes"));
app.use(
  "/messages",
  require("./routes/message.route") || require("./routes/message.route")
);
try {
  app.use("/notifications", require("./routes/notifications.routes"));
} catch (e) {
  console.warn("Notifications route not mounted:", e.message);
}

// ——————— 4. Root Test Route ———————
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ——————— 5. HTTP server and Socket.IO ———————
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: function (origin, cb) {
      if (!origin) return cb(null, true);
      if (originAllowed(origin)) return cb(null, true);
      return cb(new Error("Not allowed by CORS"));
    },
    credentials: true,
  },
});

app.set("io", io);

// Presence tracking (same as your original)
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

io.emitToUser = function (userId, event, payload) {
  try {
    const uid = String(userId);
    const set = onlineUsers.get(uid);
    if (set && set.size) {
      for (const sid of set.values()) io.to(sid).emit(event, payload);
      io.to(uid).emit(event, payload);
      console.log(
        `io.emitToUser: emitted '${event}' to user ${uid} on ${set.size} sockets`
      );
    } else {
      io.to(uid).emit(event, payload);
      console.log(
        `io.emitToUser: emitted '${event}' to room ${uid} (no socket-id map entry)`
      );
    }
  } catch (err) {
    console.warn("io.emitToUser error:", err);
  }
};

io.on("connection", (socket) => {
  console.log("socket connected:", socket.id);
  socket.on("register", async (userId) => {
    try {
      if (!userId) return;
      socket.data.userId = String(userId);
      addOnline(socket.data.userId, socket.id);
      socket.join(String(userId));
      try {
        const u = await User.findById(userId)
          .select("role username email avatarUrl")
          .lean();
        socket.data.user = u || null;
      } catch (err) {
        socket.data.user = null;
      }
      const list = await getOnlineUsersDetailed();
      io.emit("online:update", list);
    } catch (err) {
      console.error("socket register error:", err);
    }
  });

  socket.on("online:get", async (payload, cb) => {
    try {
      if (!socket.data.user || socket.data.user.role !== "admin")
        return cb && cb({ error: "unauthorized" });
      const list = await getOnlineUsersDetailed();
      return cb && cb({ ok: true, users: list });
    } catch (err) {
      return cb && cb({ error: err.message || "unknown" });
    }
  });

  socket.on("disconnect", async () => {
    try {
      removeOnlineBySocket(socket.id);
      const list = await getOnlineUsersDetailed();
      io.emit("online:update", list);
    } catch (err) {
      console.error("socket disconnect cleanup error:", err);
    }
  });
});

// ===== Ensure CORS headers on errors and add process handlers =====
app.use((err, req, res, next) => {
  try {
    const origin = req.headers.origin;
    if (origin && originAllowed(origin)) {
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET,POST,PUT,PATCH,DELETE,OPTIONS"
      );
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type,Authorization,X-Requested-With"
      );
    }

    console.error(
      "Unhandled request error:",
      err && (err.stack || err.message || err)
    );
    if (!res.headersSent) {
      const status = (err && err.status) || 500;
      return res.status(status).json({ error: err?.message || "Server error" });
    }
    return next(err);
  } catch (inner) {
    console.error("Error-handling middleware failure:", inner);
    if (!res.headersSent)
      return res.status(500).json({ error: "Server error" });
    return next(inner);
  }
});

process.on("unhandledRejection", (reason, p) => {
  console.error(
    "UNHANDLED REJECTION at:",
    p,
    "reason:",
    reason && (reason.stack || reason)
  );
});
process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err && (err.stack || err));
});

// ——————— 6. Start the server ———————
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});
