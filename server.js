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

const authRoutes = "./routes/auth.routes";
const adminRoutes = "./routes/admin.routes";
const publicProductRoutes = "./routes/products.routes";

const User = require("./models/User");

const app = express();

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

// ======= CORS: trim trailing slash & exact-match incoming origin =======
const trimSlash = (s) => (typeof s === "string" ? s.replace(/\/+$/, "") : s);
const configuredFrontendOrigin = trimSlash(
  process.env.FRONTEND_ORIGIN || "https://px39-test-final-woad.vercel.app"
);
const configuredFrontendUrl = trimSlash(process.env.FRONTEND_URL || "");

const allowedOrigins = [
  configuredFrontendOrigin,
  configuredFrontendUrl,
  "http://localhost:3000",
].filter(Boolean);

app.use(
  cors({
    origin: (incomingOrigin, callback) => {
      // allow tools / server-to-server (no Origin header)
      if (!incomingOrigin) return callback(null, true);
      const incomingClean = trimSlash(incomingOrigin);
      if (allowedOrigins.includes(incomingClean)) return callback(null, true);
      console.warn("Blocked CORS origin:", incomingOrigin, "=>", incomingClean);
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "Accept",
    ],
    methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
  })
);

// ensure preflight handled
app.options("*", cors());
// ======= end CORS changes =======

app.use(helmet());
app.use(
  rateLimit({
    windowMs: 15 * 60 * 10000,
    max: 10000,
    message: "Too many requests, please try again later.",
  })
);

// --- helper to safely require & mount routes (prevents path-to-regexp crash) ---
function safeMount(routePath, modulePath) {
  try {
    const r = require(modulePath);
    app.use(routePath, r);
    console.log(`Mounted ${modulePath} at ${routePath}`);
  } catch (err) {
    console.error(
      `Failed to mount ${modulePath} at ${routePath}:`,
      err && err.message ? err.message : err
    );
    // log full error stack to help debugging
    console.error(err && err.stack ? err.stack : err);
  }
}

// ——————— 3. Mount routes ———————
safeMount("/auth", authRoutes);
safeMount("/admin", adminRoutes);
safeMount("/products", publicProductRoutes);

// other routes (kept same paths) — wrap each require to avoid crash if one file is bad
try {
  safeMount("/user", "./routes/recentlyViewed.routes");
  safeMount("/api/wishlist", "./routes/wishlist.routes");
  safeMount("/cart", "./routes/cart.routes");
  safeMount("/orders", "./routes/order.routes");
  safeMount("/imagekit", "./routes/imagekit.routes");
  safeMount("/push", "./routes/push.routes");
  safeMount("/contacts", "./routes/contact.routes");
  safeMount("/payments", "./routes/payments.routes");
  safeMount("/messages", "./routes/message.routes");
} catch (e) {
  // safeMount already logs; keep this catch to be extra-safe
  console.warn(
    "Some optional route failed to mount:",
    e && e.message ? e.message : e
  );
}

// mount notifications (if file exists) — keep behaviour but safe
try {
  safeMount("/notifications", "./routes/notifications.routes");
} catch (e) {
  console.warn(
    "Notifications route not mounted:",
    e && e.message ? e.message : e
  );
}

// ——————— 4. Root Test Route ———————
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ——————— 5. Create HTTP server and Socket.IO ———————
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: allowedOrigins, // socket.io accepts array
    credentials: true,
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
