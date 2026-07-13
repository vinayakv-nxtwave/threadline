import { Router } from "express";
import { handleIncomingMessage, logAgentMessageFromPhone, normalizePhone } from "../services/ticketService.js";

const router = Router();

const SUPPORTED_TYPES = ["text", "image", "video", "document", "audio", "voice", "sticker"];

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
      if (!SUPPORTED_TYPES.includes(msg.type)) continue;
      if (!msg.chat_id || msg.chat_id.endsWith("@g.us")) continue; // skip groups

      // Whapi's `from` is always the channel's own number when from_me is
      // true, so chat_id (the customer's number either way) is the only
      // reliable source of the customer's phone for both directions.
      const customerPhone = normalizePhone(msg.chat_id);

      let text = null;
      let mediaUrl = null;
      let mimeType = null;
      let filename = null;
      let caption = null;

      if (msg.type === "text") {
        text = msg.text?.body;
        if (!text) continue;
      } else {
        const media = msg[msg.type]; // e.g. msg.image, msg.document
        if (!media) continue;
        mediaUrl = media.link || null;
        mimeType = media.mime_type || null;
        filename = media.filename || null;
        caption = media.caption || null;
      }

      if (msg.from_me) {
        await logAgentMessageFromPhone({
          phone: customerPhone,
          type: msg.type,
          text,
          mediaUrl,
          mimeType,
          filename,
          caption,
          whapiMessageId: msg.id,
        });
      } else {
        await handleIncomingMessage({
          phone: customerPhone,
          name: msg.from_name,
          type: msg.type,
          text,
          mediaUrl,
          mimeType,
          filename,
          caption,
          whapiMessageId: msg.id,
        });
      }
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Webhook processing error:", err);
    // Still return 200 territory errors as 500 so Whapi's retry logic kicks in
    res.status(500).json({ error: "internal error" });
  }
});

export default router;
