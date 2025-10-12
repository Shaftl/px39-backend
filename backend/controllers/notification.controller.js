// backend/controllers/notification.controller.js
const Notification = require("../models/Notification");
const { sendPushToUser } = require("../lib/push");

/**
 * GET /notifications?unread=true&limit=50
 */
exports.getNotifications = async (req, res) => {
  try {
    const userId = req.user._id;
    const unreadOnly = String(req.query.unread || "").toLowerCase() === "true";
    const limit = Math.min(parseInt(req.query.limit || "100", 10), 500);

    const filter = { user: userId };
    if (unreadOnly) filter.read = false;

    const notifications = await Notification.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return res.json({ notifications });
  } catch (err) {
    console.error("Get notifications error:", err);
    return res.status(500).json({ message: "Could not fetch notifications." });
  }
};

/**
 * POST /notifications/:id/read  (id === 'all' marks all read)
 */
exports.markAsRead = async (req, res) => {
  try {
    const userId = req.user._id;
    const { id } = req.params;

    if (!id)
      return res.status(400).json({ message: "Missing notification id." });

    if (id === "all") {
      await Notification.updateMany(
        { user: userId, read: false },
        { $set: { read: true } }
      );
      return res.json({ success: true });
    }

    const updated = await Notification.findOneAndUpdate(
      { _id: id, user: userId },
      { $set: { read: true } },
      { new: true }
    );

    if (!updated)
      return res.status(404).json({ message: "Notification not found." });
    return res.json({ success: true, notification: updated });
  } catch (err) {
    console.error("Mark notification read error:", err);
    return res.status(500).json({ message: "Could not update notification." });
  }
};

/**
 * createAndEmitNotification - create DB record (debounced) and emit via socket & web-push
 * Usage: await createAndEmitNotification({ req, userId, type, title, body, data })
 */
exports.createAndEmitNotification = async ({
  req = null,
  userId,
  type,
  title,
  body = "",
  data = {},
}) => {
  try {
    if (!userId || !type || !title)
      throw new Error("userId, type and title are required");

    // Debounce duplicate notifications created within short window (5s)
    const debounceSeconds = 5;
    const since = new Date(Date.now() - debounceSeconds * 1000);

    const query = {
      user: userId,
      type,
      title,
      createdAt: { $gte: since },
    };
    if (data && data.orderId) {
      query["data.orderId"] = String(data.orderId);
    }

    const recent = await Notification.findOne(query)
      .sort({ createdAt: -1 })
      .lean();

    let note;
    if (recent) {
      // reuse existing recent note
      note = recent;
    } else {
      // create new notification
      note = await Notification.create({
        user: userId,
        type,
        title,
        body,
        data,
        read: false,
      });
      note = note.toObject ? note.toObject() : note;
    }

    // Emit via socket.io if the app attached it (server sets app.set("io", io))
    try {
      const io = req && req.app ? req.app.get("io") : null;
      if (io) {
        io.to(String(userId)).emit("notification", note);
      }
    } catch (emitErr) {
      console.warn("Failed to emit notification via socket:", emitErr);
    }

    // Send web-push to user subscriptions (best-effort, non-blocking from UX POV)
    try {
      const pushPayload = {
        title: note.title,
        body: note.body || "",
        data: {
          ...(note.data || {}),
          url: (note.data && note.data.url) || "/",
        },
        icon: "/icons/192.png",
        badge: "/icons/badge-72.png",
      };
      await sendPushToUser(String(userId), pushPayload);
    } catch (pushErr) {
      console.warn("sendPushToUser error:", pushErr);
    }

    return note;
  } catch (err) {
    console.error("createAndEmitNotification error:", err);
    throw err;
  }
};
