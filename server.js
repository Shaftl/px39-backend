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
const publicProductRoutes = require("./routes/products.routes");

const User = require("./models/User");

const app = express();

// IMPORTANT: tell express it's behind a proxy (Render, Heroku, etc)
// so req.secure and cookie secure behavior work correctly.
app.set("trust proxy", 1);

// FRONTEND_ORIGIN: set this in Render to your frontend URL (e.g. https://my-frontend.onrender.com)
const FRONTEND_ORIGIN =
  process.env.FRONTEND_ORIGIN || "https://px39-test-final.vercel.app";
// process.env.FRONTEND_ORIGIN || "http://localhost:3000";

// ——————— 1. Connect to MongoDB ———————
const mongoUri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/px39";

// modern mongoose: avoid deprecated options
const mongooseOptions = {
  // shorter selection timeout helps fail fast while debugging (ms)
  serverSelectionTimeoutMS: 10000,
};

mongoose
  .connect(mongoUri, mongooseOptions)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err);
    // DON'T call process.exit(1) while debugging — nodemon will stop and you lose logs.
  });

// Extra listeners for helpful runtime logs:
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

// CORS must allow credentials and the exact frontend origin
app.use(
  cors({
    origin: FRONTEND_ORIGIN,
    credentials: true,
  })
);

app.use(helmet());
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10000,
    message: "Too many requests, please try again later.",
  })
);

// ——————— 3. Mount routes ———————
app.use("/auth", authRoutes);
app.use("/admin", adminRoutes);
app.use("/products", publicProductRoutes);
// in backend/app.js or server.js (where routes are registered)
app.use("/user", require("./routes/recentlyViewed.routes"));

app.use("/api/wishlist", require("./routes/wishlist.routes"));
app.use("/cart", require("./routes/cart.routes"));
const orderRoutes = require("./routes/order.routes");
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
  // If notifications route not present, just keep going (helps safe deploy)
  console.warn("Notifications route not mounted:", e.message);
}

// ——————— 4. Root Test Route ———————
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ——————— 5. Create HTTP server and Socket.IO ———————
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: FRONTEND_ORIGIN,
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
 */
io.emitToUser = function (userId, event, payload) {
  try {
    const uid = String(userId);
    const set = onlineUsers.get(uid);
    if (set && set.size) {
      for (const sid of set.values()) {
        io.to(sid).emit(event, payload);
      }
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
  console.log(`🚀 Server listening on port ${PORT}`);
});
