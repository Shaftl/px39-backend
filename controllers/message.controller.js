const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const User = require("../models/User");
const nc = require("./notification.controller"); // createAndEmitNotification
const mongoose = require("mongoose");

/**
 * Helper: normalize participant ids for a conversation
 */
function participantIds(conv) {
  if (!conv || !Array.isArray(conv.participants)) return [];
  return conv.participants.map((p) => String(p && (p._id || p)));
}

/**
 * Admin -> create conversation (if not exist) and send initial message.
 * POST /admin/messages
 * body: { userId, subject, content }
 */
exports.adminSendMessage = async (req, res) => {
  try {
    const adminId = req.user && req.user._id;
    const { userId, subject, content } = req.body;

    if (!userId || !content) {
      return res
        .status(400)
        .json({ message: "userId and content are required" });
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "Invalid userId" });
    }

    // Ensure target exists
    const target = await User.findById(userId)
      .select("_id username email")
      .lean();
    if (!target)
      return res.status(404).json({ message: "Target user not found" });

    // Create a conversation (always create new conversation for now).
    const conv = await Conversation.create({
      participants: [adminId, userId],
      subject: subject || "",
      lastMessageAt: new Date(),
    });

    const message = await Message.create({
      conversation: conv._id,
      from: adminId,
      to: userId,
      content,
    });

    // populate message for a richer payload
    const populatedMessage = await Message.findById(message._id)
      .populate("from", "username email")
      .populate("to", "username email")
      .lean();

    // notify recipient (user) via existing notification controller
    try {
      await nc.createAndEmitNotification({
        req,
        userId,
        type: "message",
        title: subject ? `Message: ${subject}` : "New message from admin",
        body: content.length > 160 ? content.slice(0, 157) + "..." : content,
        data: {
          conversationId: String(conv._id),
          messageId: String(message._id),
          url: `/messages/${conv._id}`,
        },
      });
    } catch (err) {
      console.warn("adminSendMessage: failed to notify recipient:", err);
    }

    // Emit message socket -> also notify sender about "delivered" to the recipient
    try {
      const io = req && req.app ? req.app.get("io") : null;
      if (io) {
        // Emit a full message payload to recipient via the reliable helper
        io.emitToUser(userId, "message", populatedMessage);

        // notify sender (admin) that the message was delivered to recipient (room deliver)
        io.emitToUser(adminId, "message_delivered", {
          conversationId: String(conv._id),
          messageId: String(message._id),
          deliveredTo: String(userId),
        });

        console.log("adminSendMessage: emitted message and delivered events", {
          to: userId,
          messageId: String(message._id),
        });
      }
    } catch (emitErr) {
      console.warn("adminSendMessage: socket emit failed:", emitErr);
    }

    return res
      .status(201)
      .json({ conversation: conv, message: populatedMessage });
  } catch (err) {
    console.error("adminSendMessage error:", err);
    return res.status(500).json({ message: "Could not send message." });
  }
};

/**
 * Get conversations for current user
 * GET /messages
 */
exports.getConversations = async (req, res) => {
  try {
    const userId = req.user._id;

    const convs = await Conversation.find({ participants: userId })
      .sort({ lastMessageAt: -1 })
      .populate({
        path: "participants",
        select: "username email",
      })
      .lean();

    // Optionally attach last message preview
    const convIds = convs.map((c) => c._id);
    const lastMessages = await Message.aggregate([
      { $match: { conversation: { $in: convIds } } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: "$conversation",
          messageId: { $first: "$_id" },
          content: { $first: "$content" },
          from: { $first: "$from" },
          createdAt: { $first: "$createdAt" },
        },
      },
    ]);

    const lmByConv = {};
    lastMessages.forEach((m) => (lmByConv[String(m._id)] = m));
    // attach preview
    const enriched = convs.map((c) => ({
      ...c,
      lastMessage: lmByConv[String(c._id)] || null,
    }));

    return res.json({ conversations: enriched });
  } catch (err) {
    console.error("getConversations error:", err);
    return res.status(500).json({ message: "Could not fetch conversations." });
  }
};

/**
 * Get messages in a conversation (GET /messages/:id)
 */
exports.getMessages = async (req, res) => {
  try {
    const userId = req.user._id;
    const convId = req.params.id;
    if (!convId || !mongoose.Types.ObjectId.isValid(convId))
      return res.status(400).json({ message: "Invalid conversation id" });

    // populate participants for client use
    const conv = await Conversation.findById(convId)
      .populate("participants", "username email")
      .lean();
    if (!conv)
      return res.status(404).json({ message: "Conversation not found" });

    const pids = participantIds(conv);
    if (!pids.includes(String(userId))) {
      return res.status(403).json({ message: "Not a participant" });
    }

    // fetch messages
    let messages = await Message.find({ conversation: convId })
      .sort({ createdAt: 1 })
      .populate("from", "username email")
      .populate("to", "username email")
      .lean();

    // Determine which messages (sent by others) should be marked as seen by this user
    const toMark = messages
      .filter(
        (m) =>
          String(m.from) !== String(userId) &&
          !(
            Array.isArray(m.seenBy) &&
            m.seenBy.map(String).includes(String(userId))
          )
      )
      .map((m) => m._id);

    if (toMark.length > 0) {
      // mark them seen
      await Message.updateMany(
        { _id: { $in: toMark } },
        { $addToSet: { seenBy: userId } }
      ).exec();

      // emit 'message_seen' to other participants (notify sender(s))
      try {
        const io = req && req.app ? req.app.get("io") : null;
        if (io) {
          for (const pid of pids) {
            if (String(pid) === String(userId)) continue;
            io.emitToUser(pid, "message_seen", {
              conversationId: convId,
              messageIds: toMark.map(String),
              seenBy: String(userId),
            });
          }
        }
      } catch (emitErr) {
        console.warn("Failed to emit message_seen:", emitErr);
      }

      // re-fetch messages so seenBy fields are up-to-date in response
      messages = await Message.find({ conversation: convId })
        .sort({ createdAt: 1 })
        .populate("from", "username email")
        .populate("to", "username email")
        .lean();
    }

    return res.json({ conversation: conv, messages });
  } catch (err) {
    console.error("getMessages error:", err && err.stack ? err.stack : err);
    return res.status(500).json({ message: "Could not fetch messages." });
  }
};

/**
 * Reply in a conversation (POST /messages/:id/reply)
 */
exports.replyToConversation = async (req, res) => {
  try {
    const userId = req.user._id;
    const convId = req.params.id;
    const { content } = req.body;

    if (!content || !content.trim())
      return res.status(400).json({ message: "content is required" });
    if (!convId || !mongoose.Types.ObjectId.isValid(convId))
      return res.status(400).json({ message: "Invalid conversation id" });

    const conv = await Conversation.findById(convId);
    if (!conv)
      return res.status(404).json({ message: "Conversation not found" });

    const pids = participantIds(conv);
    if (!pids.includes(String(userId))) {
      return res.status(403).json({ message: "Not a participant" });
    }

    // recipient(s) are participants except sender
    const recipients = pids.filter((p) => String(p) !== String(userId));
    const toId = recipients.length ? recipients[0] : null; // pick first recipient

    const msg = await Message.create({
      conversation: conv._id,
      from: userId,
      to: toId || userId,
      content,
    });

    // update conversation lastMessageAt
    conv.lastMessageAt = new Date();
    await conv.save();

    // notify recipients individually (DB notification + socket)
    for (const r of recipients) {
      try {
        await nc.createAndEmitNotification({
          req,
          userId: r,
          type: "message",
          title: `New message`,
          body: content.length > 160 ? content.slice(0, 157) + "..." : content,
          data: {
            conversationId: String(conv._id),
            messageId: String(msg._id),
            url: `/messages/${conv._id}`,
          },
        });
      } catch (e) {
        console.warn("replyToConversation: notify failed:", e);
      }
    }

    // Also emit a dedicated 'message' socket event containing the new message (if io present)
    try {
      const io = req && req.app ? req.app.get("io") : null;
      if (io) {
        // populate the message to send a consistent payload to clients
        const populated = await Message.findById(msg._id)
          .populate("from", "username email")
          .populate("to", "username email")
          .lean();

        for (const r of recipients) {
          io.emitToUser(r, "message", populated);

          // tell the sender that message was delivered to recipient r (so client can show delivered tick)
          io.emitToUser(userId, "message_delivered", {
            conversationId: String(conv._id),
            messageId: String(msg._id),
            deliveredTo: String(r),
          });
        }
      }
    } catch (emitErr) {
      console.warn("Failed to emit message socket event:", emitErr);
    }

    const populated = await Message.findById(msg._id)
      .populate("from", "username email")
      .lean();
    return res.status(201).json({ message: populated });
  } catch (err) {
    console.error("replyToConversation error:", err);
    return res.status(500).json({ message: "Could not send reply." });
  }
};

/**
 * Mark conversation messages as seen by current user (POST /messages/:id/seen)
 */
exports.markConversationSeen = async (req, res) => {
  try {
    const userId = req.user._id;
    const convId = req.params.id;
    if (!convId || !mongoose.Types.ObjectId.isValid(convId))
      return res.status(400).json({ message: "Invalid conversation id" });

    const conv = await Conversation.findById(convId).lean();
    if (!conv)
      return res.status(404).json({ message: "Conversation not found" });

    const pids = participantIds(conv);
    if (!pids.includes(String(userId))) {
      return res.status(403).json({ message: "Not a participant" });
    }

    // find messages sent by others and not yet seen by this user
    const messages = await Message.find({ conversation: convId }).lean();
    const toMark = messages
      .filter(
        (m) =>
          String(m.from) !== String(userId) &&
          !(
            Array.isArray(m.seenBy) &&
            m.seenBy.map(String).includes(String(userId))
          )
      )
      .map((m) => m._id);

    if (toMark.length > 0) {
      await Message.updateMany(
        { _id: { $in: toMark } },
        { $addToSet: { seenBy: userId } }
      ).exec();

      // emit 'message_seen' to other participants
      try {
        const io = req && req.app ? req.app.get("io") : null;
        if (io) {
          for (const pid of pids) {
            if (String(pid) === String(userId)) continue;
            io.emitToUser(pid, "message_seen", {
              conversationId: convId,
              messageIds: toMark.map(String),
              seenBy: String(userId),
            });
          }
        }
      } catch (emitErr) {
        console.warn("Failed to emit message_seen:", emitErr);
      }
    }

    return res.json({ updated: toMark.length });
  } catch (err) {
    console.error("markConversationSeen error:", err);
    return res.status(500).json({ message: "Could not mark seen." });
  }
};

/**
 * Like/unlike a message (toggle)
 * POST /messages/message/:id/like
 */
exports.toggleLikeMessage = async (req, res) => {
  try {
    const userId = req.user._id;
    const messageId = req.params.id;
    if (!messageId || !mongoose.Types.ObjectId.isValid(messageId))
      return res.status(400).json({ message: "Invalid message id" });

    const msg = await Message.findById(messageId);
    if (!msg) return res.status(404).json({ message: "Message not found" });

    const already = msg.likes.map(String).includes(String(userId));
    if (already) {
      // remove like
      msg.likes = msg.likes.filter((x) => String(x) !== String(userId));
    } else {
      msg.likes.push(userId);
    }
    await msg.save();

    // notify message author (if liker is not author)
    if (!String(msg.from).includes(String(userId))) {
      try {
        await nc.createAndEmitNotification({
          req,
          userId: msg.from,
          type: "message_interaction",
          title: already ? "Like removed" : "Message liked",
          body: `${req.user?.username || "Someone"} ${
            already ? "removed like from" : "liked"
          } your message.`,
          data: {
            conversationId: String(msg.conversation),
            messageId: String(msg._id),
          },
        });
      } catch (e) {
        console.warn("toggleLikeMessage: notify failed:", e);
      }
    }

    // emit updated message to participants so UI updates in realtime
    try {
      const populated = await Message.findById(msg._id)
        .populate("from", "username email")
        .populate("to", "username email")
        .lean();

      const conv = await Conversation.findById(msg.conversation).lean();
      const pids = participantIds(conv);

      const io = req && req.app ? req.app.get("io") : null;
      if (io) {
        for (const pid of pids) {
          io.emitToUser(pid, "message_updated", { message: populated });
        }
      }

      return res.json({ message: populated });
    } catch (emitErr) {
      console.warn("toggleLikeMessage: emit failed", emitErr);
      const populated = await Message.findById(msg._id)
        .populate("from", "username email")
        .populate("to", "username email")
        .lean();
      return res.json({ message: populated });
    }
  } catch (err) {
    console.error("toggleLikeMessage error:", err);
    return res.status(500).json({ message: "Could not like/unlike message." });
  }
};
