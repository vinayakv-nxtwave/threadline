import { Router } from "express";
import { pool } from "../db.js";
import { addMessage } from "../services/ticketService.js";
import { sendText } from "../services/whapiClient.js";

const router = Router();

// GET /api/tickets?status=open&category=technical&search=priya
router.get("/", async (req, res) => {
  const { status, category, search } = req.query;
  const clauses = [];
  const params = [];

  if (status) {
    params.push(status);
    clauses.push(`t.status = $${params.length}`);
  }
  if (category) {
    params.push(category);
    clauses.push(`t.category = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    clauses.push(
      `(t.student_name ILIKE $${params.length} OR t.student_phone ILIKE $${params.length} OR t.ticket_no ILIKE $${params.length})`
    );
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const { rows } = await pool.query(
    `SELECT t.*, lm.body AS last_message_body, lm.direction AS last_message_direction
     FROM tickets t
     LEFT JOIN LATERAL (
       SELECT body, direction FROM messages WHERE ticket_id = t.id ORDER BY created_at DESC LIMIT 1
     ) lm ON true
     ${where}
     ORDER BY t.last_message_at DESC`,
    params
  );
  res.json(rows);
});

// GET /api/tickets/:id  -> ticket + full message thread
router.get("/:id", async (req, res) => {
  const { rows: ticketRows } = await pool.query("SELECT * FROM tickets WHERE id = $1", [
    req.params.id,
  ]);
  if (!ticketRows[0]) return res.status(404).json({ error: "not found" });

  const { rows: messages } = await pool.query(
    "SELECT * FROM messages WHERE ticket_id = $1 ORDER BY created_at ASC",
    [req.params.id]
  );
  res.json({ ...ticketRows[0], messages });
});

// PATCH /api/tickets/:id  -> update status / category / priority / assignee / notes / tags
router.patch("/:id", async (req, res) => {
  const { status, category, priority, assignee, notes, tags } = req.body;

  const { rows: current } = await pool.query("SELECT * FROM tickets WHERE id = $1", [
    req.params.id,
  ]);
  if (!current[0]) return res.status(404).json({ error: "not found" });

  // Server-side enforcement of the core rule: can't close an unresolved ticket.
  if (status === "closed" && current[0].status !== "resolved") {
    return res
      .status(400)
      .json({ error: "Ticket must be marked resolved before it can be closed." });
  }

  const fields = { status, category, priority, assignee, notes, tags };
  const sets = [];
  const params = [];
  for (const [key, val] of Object.entries(fields)) {
    if (val !== undefined) {
      params.push(val);
      sets.push(`${key} = $${params.length}`);
    }
  }
  if (!sets.length) return res.status(400).json({ error: "no fields to update" });

  params.push(req.params.id);
  const { rows } = await pool.query(
    `UPDATE tickets SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`,
    params
  );
  res.json(rows[0]);
});

// POST /api/tickets/:id/reply  -> agent reply, sent out over WhatsApp via Whapi
router.post("/:id/reply", async (req, res) => {
  const { body } = req.body;
  if (!body || !body.trim()) return res.status(400).json({ error: "body is required" });

  const { rows } = await pool.query("SELECT * FROM tickets WHERE id = $1", [req.params.id]);
  const ticket = rows[0];
  if (!ticket) return res.status(404).json({ error: "not found" });

  let whapiResponse;
  try {
    whapiResponse = await sendText(ticket.student_phone, body);
  } catch (err) {
    console.error("Whapi send error:", err);
    return res.status(502).json({ error: "failed to send message via Whapi" });
  }

  const whapiMessageId = whapiResponse?.message?.id || whapiResponse?.id || null;
  await addMessage(ticket.id, "outbound", body, whapiMessageId);

  if (ticket.status === "new") {
    await pool.query(`UPDATE tickets SET status = 'open' WHERE id = $1`, [ticket.id]);
  }

  res.json({ ok: true });
});

export default router;
