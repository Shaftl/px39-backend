// backend/lib/push.js
const webpush = require("web-push");
const PushSubscription = require("../models/PushSubscription");

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:admin@example.com";

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} else {
  console.warn(
    "VAPID keys missing. Web Push disabled until keys are configured."
  );
}

/**
 * sendPushToUser(userId, payload)
 * payload: { title, body, data, icon, badge, url }
 */
async function sendPushToUser(userId, payload) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return;

  const subs = await PushSubscription.find({ user: userId }).lean();
  if (!subs || subs.length === 0) return;

  const results = [];
  for (const s of subs) {
    try {
      await webpush.sendNotification(s.subscription, JSON.stringify(payload));
      results.push({ endpoint: s.subscription.endpoint, ok: true });
    } catch (err) {
      const statusCode = err && err.statusCode;
      console.warn(
        "web-push send error for endpoint",
        s.subscription.endpoint,
        statusCode
      );
      if (statusCode === 410 || statusCode === 404) {
        await PushSubscription.deleteOne({ _id: s._id });
        results.push({
          endpoint: s.subscription.endpoint,
          ok: false,
          removed: true,
        });
      } else {
        results.push({
          endpoint: s.subscription.endpoint,
          ok: false,
          error: String(err),
        });
      }
    }
  }
  return results;
}

module.exports = { sendPushToUser, VAPID_PUBLIC_KEY };
