import { Router } from "express";
import { handleIncomingMessage } from "../services/ticketService.js";

const router = Router();

// Whapi posts here whenever a message-related event fires on your channel.
// Configure this URL (with your secret) as the webhook in the Whapi dashboard:
//   https://your-domain.com/webhook/whapi?secret=YOUR_WEBHOOK_SECRET
router.post("/whapi", async (req, res) => {
  if (process.env.WEBHOOK_SECRET && req.query.secret !== process.env.WEBHOOK_SECRET) {
    return res.status(401).json({ error: "invalid secret" });
  }

  const messages = req.body?.messages || [];

  try {
    for (const msg of messages) {
      if (msg.from_me) continue; // ignore our own outgoing messages echoed back
      if (msg.type !== "text" || !msg.text?.body) continue; // MVP: text only, see README

      await handleIncomingMessage({
        phone: msg.from,
        name: msg.from_name,
        text: msg.text.body,
        whapiMessageId: msg.id,
      });
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Webhook processing error:", err);
    // Still return 200 territory errors as 500 so Whapi's retry logic kicks in
    res.status(500).json({ error: "internal error" });
  }
});

export default router;
