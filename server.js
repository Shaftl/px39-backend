require("dotenv").config();
const express = require("express");
const http = require("http");
const mongoose = require("mongoose");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const path = require("path");
const { Server } = require("socket.io");

const authRoutes = require("./routes/auth.routes");
const adminRoutes = require("./routes/admin.routes");
const orderRoutes = require("./routes/order.routes");
const publicProductRoutes = require("./routes/products.routes");

const User = require("./models/User");

const app = express();

/**
 * IMPORTANT:
 * - Trust proxy so Express knows it's behind a proxy (Render, etc.)
 *   This is required so cookies with `secure: true` behave correctly.
 */
app.set("trust proxy", 1);

// ——————— 1. Connect to MongoDB ———————
const mongoUri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/px39";
mongoose
  .connect(mongoUri)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err);
    process.exit(1);
  });

console.log("User model loaded:", !!User);

// ——————— 2. Global Middleware ———————
app.use(express.json());
app.use(cookieParser());

/**
 * CORS: Support multiple frontend origins via FRONTEND_ORIGINS env var (comma-separated).
 * Falls back to FRONTEND_ORIGIN / FRONTEND_URL single value or a small sensible default list.
 *
 * Example:
 * FRONTEND_ORIGINS=https://px39-test-final-woad.vercel.app,https://px39-test-final.vercel.app,http://localhost:3000
 */
const rawOrigins = process.env.FRONTEND_ORIGINS || "";
let allowedOrigins = [];

if (rawOrigins && rawOrigins.trim()) {
  allowedOrigins = rawOrigins
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
} else {
  // fallback single env keys
  const single = process.env.FRONTEND_ORIGIN || process.env.FRONTEND_URL;
  if (single) allowedOrigins.push(single.trim());
  // sensible defaults for local/dev + previously used hosts
  allowedOrigins = allowedOrigins
    .concat([
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "https://px39-test-final-woad.vercel.app",
      "https://px39-test-final.vercel.app",
    ])
    .filter(Boolean);
}

// de-duplicate
allowedOrigins = Array.from(new Set(allowedOrigins));

console.log("CORS allowed origins:", allowedOrigins);

app.use(
  cors({
    origin: function (origin, callback) {
      // allow same-origin server requests (no origin), tools like curl, or server-to-server
      if (!origin) return callback(null, true);
      // if origin exactly matches any allowed origin, allow it
      if (allowedOrigins.indexOf(origin) !== -1) {
        return callback(null, true);
      }
      // otherwise block
      const msg = `CORS policy: origin '${origin}' is not allowed by server.`;
      console.warn(msg);
      return callback(new Error(msg), false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    // <-- added idempotency header name variants here so preflight accepts them
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "x-imagekit-key",
      "X-Requested-With",
      "Accept",
      "Origin",
      "Referer",
      "Idempotency-Key",
      "idempotency-key",
      "X-Idempotency-Key",
      "x-idempotency-key",
      // some clients might use camelCase or other variants:
      "idempotencyKey",
    ],
    preflightContinue: false,
    optionsSuccessStatus: 204,
  })
);

app.use(helmet());
app.use(
  rateLimit({
    windowMs: 15 * 60 * 10000,
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
app.use("/orders", orderRoutes);
app.use("/imagekit", require("./routes/imagekit.routes"));
app.use("/push", require("./routes/push.routes"));
app.use("/contacts", require("./routes/contact.routes"));
app.use("/payments", require("./routes/payments.routes"));

app.use("/messages", require("./routes/message.routes"));
// mount notifications (if file exists)
try {
  app.use("/notifications", require("./routes/notifications.routes"));
} catch (e) {
  console.warn("Notifications route not mounted:", e.message);
}

// ——————— 4. Root Test Route ———————
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ——————— 5. Create HTTP server and Socket.IO ———————
const server = http.createServer(app);

// socket.io CORS: mirror same allowedOrigins (socket.io accepts array or boolean)
const ioCorsOrigins = allowedOrigins.length ? allowedOrigins : true;

const io = new Server(server, {
  cors: {
    origin: ioCorsOrigins,
    credentials: true,
    methods: ["GET", "POST"],
    // <-- mirror idempotency header variants here as well
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "x-imagekit-key",
      "X-Requested-With",
      "Accept",
      "Idempotency-Key",
      "idempotency-key",
      "X-Idempotency-Key",
      "x-idempotency-key",
      "idempotencyKey",
    ],
  },
});

// make io available in req.app
app.set("io", io);

/**
 * -------------------------
 * Presence tracking additions
 * -------------------------
 */
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
/* end presence additions */

/**
 * Reliable emit helper attached to io
 * - emits directly to each known socket id for user (onlineUsers map)
 * - falls back to room-based emit (io.to(userId).emit)
 */
io.emitToUser = function (userId, event, payload) {
  try {
    const uid = String(userId);
    const set = onlineUsers.get(uid);
    if (set && set.size) {
      for (const sid of set.values()) {
        // direct socket-id emit
        io.to(sid).emit(event, payload);
      }
      // also emit to user-room (harmless duplicate for clients that joined room)
      io.to(uid).emit(event, payload);
      console.log(
        `io.emitToUser: emitted '${event}' to user ${uid} on ${set.size} sockets`
      );
    } else {
      // fallback to room emit
      io.to(uid).emit(event, payload);
      console.log(
        `io.emitToUser: emitted '${event}' to room ${uid} (no socket-id map entry)`
      );
    }
  } catch (err) {
    console.warn("io.emitToUser error:", err);
  }
};

/* simple socket auth/register pattern (client should emit 'register' with userId after login) */
io.on("connection", (socket) => {
  console.log("socket connected:", socket.id);

  socket.on("register", async (userId) => {
    console.log(`socket ${socket.id} register called with userId:`, userId);
    try {
      if (!userId) {
        console.log("register: no userId provided");
        return;
      }
      socket.data.userId = String(userId);
      addOnline(socket.data.userId, socket.id);

      // join user-specific room
      socket.join(String(userId));

      // attach basic user info for authorization checks (best-effort)
      try {
        const u = await User.findById(userId)
          .select("role username email avatarUrl")
          .lean();
        socket.data.user = u || null;
      } catch (err) {
        socket.data.user = null;
      }

      console.log(
        `socket ${socket.id} joined room ${String(userId)}. rooms:`,
        Array.from(socket.rooms)
      );

      // broadcast updated online list to all connected sockets
      const list = await getOnlineUsersDetailed();
      io.emit("online:update", list);
    } catch (err) {
      console.error("socket register error:", err);
    }
  });

  socket.on("online:get", async (payload, cb) => {
    try {
      if (!socket.data.user || socket.data.user.role !== "admin") {
        return cb && cb({ error: "unauthorized" });
      }
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

// ——————— 6. Start the server ———————
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`🚀 Server listening on http://localhost:${PORT}`);
});
