import { Router } from "express";
import { handleIncomingMessage } from "../services/ticketService.js";

// Beta-only helpers. index.js mounts this router only when APP_ENV=beta, so
// none of these routes exist in production.
const router = Router();

// POST /api/dev/simulate-inbound  { phone, name?, text }
// Stands in for a real student WhatsApp message, since beta has no Whapi
// channel of its own. Goes through exactly the same path as the webhook.
router.post("/simulate-inbound", async (req, res) => {
  const { phone, name, text } = req.body || {};
  if (!phone || !String(phone).replace(/\D/g, "")) {
    return res.status(400).json({ error: "phone is required" });
  }
  if (!text || !text.trim()) return res.status(400).json({ error: "text is required" });

  const { ticket, newTicketCreated } = await handleIncomingMessage({
    phone,
    name: name || null,
    type: "text",
    text: text.trim(),
    whapiMessageId: `beta-sim-${Date.now()}`,
  });
  res.json({ ok: true, ticketId: ticket.id, ticketNo: ticket.ticket_no, newTicketCreated });
});

export default router;
