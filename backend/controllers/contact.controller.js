const InboundContact = require("../models/InboundContact");
const { body, validationResult } = require("express-validator");

const {
  sendInboundContactEmail,
  sendContactAutoReply,
} = require("../utils/email");

// POST /contacts
const createContactValidators = [
  body("name").trim().isLength({ min: 1 }).withMessage("Name required"),
  body("email").isEmail().withMessage("Valid email required"),
  body("message").trim().isLength({ min: 1 }).withMessage("Message required"),
];

async function createContact(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  try {
    const { name, email, phone, message } = req.body;
    const ip = req.ip || req.connection?.remoteAddress || "";
    const contact = await InboundContact.create({
      name,
      email,
      phone: phone || "",
      message,
      ip,
      user: req.user ? req.user._id : undefined,
    });

    // send admin email (await so we know if it fails — but don't block core case)
    try {
      await sendInboundContactEmail({ name, email, phone, message });
    } catch (err) {
      console.error("Inbound contact email failed:", err);
    }

    // notify admin(s) via socket.io if available
    try {
      const io = req.app.get("io");
      if (io) {
        // fetch the saved contact populated with user (safe public fields)
        const populated = await InboundContact.findById(contact._id)
          .populate("user", "username email avatarUrl")
          .lean();

        if (populated) {
          io.emit("contacts:new", populated);
        } else {
          // fallback to minimal payload if populate fails
          const userInfo = req.user
            ? {
                _id: req.user._id,
                username: req.user.username,
                email: req.user.email,
                avatarUrl: req.user.avatarUrl,
              }
            : undefined;

          io.emit("contacts:new", {
            _id: contact._id,
            name: contact.name,
            email: contact.email,
            phone: contact.phone || "",
            user: userInfo,
            message: contact.message.slice(0, 200),
            createdAt: contact.createdAt,
          });
        }
      }
    } catch (err) {
      console.error("Socket notify failed:", err);
    }

    return res.status(201).json({ message: "Contact saved", data: contact });
  } catch (err) {
    console.error("createContact error:", err);
    return res.status(500).json({ message: "Server error" });
  }
}

// GET /contacts (admin)
async function listContacts(req, res) {
  try {
    // populate user (only needed fields) so admin can see avatar/username/email
    const contacts = await InboundContact.find({})
      .sort({ createdAt: -1 })
      .populate("user", "username email avatarUrl")
      .lean();
    res.json(contacts);
  } catch (err) {
    console.error("listContacts error:", err);
    res.status(500).json({ message: "Server error" });
  }
}

// PATCH /contacts/:id/read (admin)
async function markRead(req, res) {
  try {
    const { id } = req.params;
    const updated = await InboundContact.findByIdAndUpdate(
      id,
      { read: true },
      { new: true }
    ).lean();
    if (!updated) return res.status(404).json({ message: "Not found" });
    return res.json(updated);
  } catch (err) {
    console.error("markRead error:", err);
    res.status(500).json({ message: "Server error" });
  }
}

// POST /contacts/:id/reply (admin)
async function replyContact(req, res) {
  try {
    const { id } = req.params;
    const { response } = req.body;

    if (!response || String(response).trim() === "") {
      return res.status(400).json({ message: "Response message required" });
    }

    const contact = await InboundContact.findById(id).lean();
    if (!contact) return res.status(404).json({ message: "Contact not found" });

    // send reply email to sender (do not throw on failure)
    try {
      await sendContactAutoReply({
        to: contact.email,
        name: contact.name,
        message: response,
      });
    } catch (err) {
      console.error("sendContactAutoReply failed:", err);
    }

    // save reply metadata and mark as read
    const updatedRaw = await InboundContact.findByIdAndUpdate(
      id,
      {
        read: true,
        $set: {
          "meta.lastReply": {
            message: response,
            admin: req.user ? req.user._id : undefined,
            createdAt: new Date(),
          },
        },
      },
      { new: true }
    );

    // fetch populated version to return to admin UI
    const updated = await InboundContact.findById(updatedRaw._id)
      .populate("user", "username email avatarUrl")
      .lean();

    // optionally notify via socket so admin UI / others refresh
    try {
      const io = req.app.get("io");
      if (io) {
        io.emit("contacts:replied", {
          _id: updated._id,
          lastReply: updated.meta?.lastReply || null,
          read: updated.read,
        });
      }
    } catch (err) {
      console.error("Socket notify (reply) failed:", err);
    }

    return res.json(updated);
  } catch (err) {
    console.error("replyContact error:", err);
    res.status(500).json({ message: "Server error" });
  }
}

// DELETE /contacts/:id (admin)
async function deleteContact(req, res) {
  try {
    const { id } = req.params;
    await InboundContact.findByIdAndDelete(id);
    return res.json({ message: "Deleted" });
  } catch (err) {
    console.error("deleteContact error:", err);
    res.status(500).json({ message: "Server error" });
  }
}

module.exports = {
  createContact,
  createContactValidators,
  listContacts,
  markRead,
  deleteContact,
  replyContact,
};
