// backend/routes/notifications.routes.js
const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth.middleware");
const nc = require("../controllers/notification.controller");

router.use(auth);

router.get("/", nc.getNotifications);
router.post("/:id/read", nc.markAsRead); // use id='all' to mark all read

module.exports = router;
