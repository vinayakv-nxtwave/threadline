import { Router } from "express";
import { processWhapiMessage } from "../services/whapiIngest.js";

const router = Router();

// Whapi posts here whenever a message-related event fires on your channel.
// Configure this URL (with your secret) as the webhook in the Whapi dashboard:
//   https://your-domain.com/webhook/whapi?secret=YOUR_WEBHOOK_SECRET
//
// Each message is stored independently (one bad message can't block the rest
// of the batch), and anything that fails here -- or never arrives because the
// server was asleep -- is picked up by the catch-up sync (whapiSync.js).
router.post("/whapi", async (req, res) => {
  if (process.env.WEBHOOK_SECRET && req.query.secret !== process.env.WEBHOOK_SECRET) {
    return res.status(401).json({ error: "invalid secret" });
  }

  const messages = req.body?.messages || [];
  let failed = 0;
  for (const msg of messages) {
    try {
      await processWhapiMessage(msg);
    } catch (err) {
      failed++;
      console.error(`Webhook: failed to store message ${msg?.id}:`, err);
    }
  }
  // 500 lets Whapi retry if retries are enabled; storing is idempotent, so a
  // retry of the messages that did succeed is harmless.
  if (failed) return res.status(500).json({ error: `${failed} message(s) failed`, failed });
  res.status(200).json({ ok: true });
});

export default router;
