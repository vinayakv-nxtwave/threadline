import { Router } from "express";
import multer from "multer";
import { pool } from "../db.js";
import { addMessage, getTurnaroundTime } from "../services/ticketService.js";
import { sendText, sendMedia } from "../services/whapiClient.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 16 * 1024 * 1024 } });

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
    `SELECT t.*, lm.body AS last_message_body, lm.direction AS last_message_direction,
       EXTRACT(EPOCH FROM (
         (SELECT MIN(m.created_at) FROM messages m
          WHERE m.ticket_id = t.id AND m.direction = 'outbound'
            AND m.created_at > COALESCE(t.last_reopened_at, t.created_at))
         - COALESCE(t.last_reopened_at, t.created_at)
       )) AS turnaround_seconds,
       CASE WHEN t.resolved_at IS NOT NULL THEN
         EXTRACT(EPOCH FROM (t.resolved_at - COALESCE(t.last_reopened_at, t.created_at)))
       END AS resolution_seconds
     FROM tickets t
     LEFT JOIN LATERAL (
       SELECT body, direction FROM messages WHERE ticket_id = t.id ORDER BY created_at DESC LIMIT 1
     ) lm ON true
     ${where}
     ORDER BY t.last_message_at DESC`,
    params
  );
  res.json(
    rows.map((r) => ({
      ...r,
      turnaroundSeconds: r.turnaround_seconds != null ? Math.round(r.turnaround_seconds) : null,
      resolutionSeconds: r.resolution_seconds != null ? Math.round(r.resolution_seconds) : null,
    }))
  );
});

// GET /api/tickets/stats/summary -> dashboard-wide average response/resolution times
// Must come before GET /:id, or Express matches "stats" as an :id param.
router.get("/stats/summary", async (req, res) => {
  const { rows: avgResolution } = await pool.query(`
    SELECT AVG(EXTRACT(EPOCH FROM (resolved_at - COALESCE(last_reopened_at, created_at)))) AS avg_seconds
    FROM tickets WHERE resolved_at IS NOT NULL
  `);

  const { rows: avgTurnaround } = await pool.query(`
    WITH pairs AS (
      SELECT t.id AS ticket_id,
             COALESCE(t.last_reopened_at, t.created_at) AS opened_at,
             MIN(m.created_at) AS reply_at
      FROM tickets t
      JOIN messages m ON m.ticket_id = t.id
        AND m.direction = 'outbound'
        AND m.created_at > COALESCE(t.last_reopened_at, t.created_at)
      GROUP BY t.id, t.last_reopened_at, t.created_at
    )
    SELECT AVG(EXTRACT(EPOCH FROM (reply_at - opened_at))) AS avg_seconds
    FROM pairs
  `);

  res.json({
    avgResolutionSeconds: avgResolution[0].avg_seconds ? Math.round(avgResolution[0].avg_seconds) : null,
    avgTurnaroundSeconds: avgTurnaround[0].avg_seconds ? Math.round(avgTurnaround[0].avg_seconds) : null,
  });
});

// GET /api/tickets/:id  -> ticket + full message thread
router.get("/:id", async (req, res) => {
  const { rows: ticketRows } = await pool.query("SELECT * FROM tickets WHERE id = $1", [
    req.params.id,
  ]);
  if (!ticketRows[0]) return res.status(404).json({ error: "not found" });
  const ticket = ticketRows[0];

  const { rows: messages } = await pool.query(
    "SELECT * FROM messages WHERE ticket_id = $1 ORDER BY created_at ASC",
    [req.params.id]
  );

  const turnaroundTime = await getTurnaroundTime(ticket.id);
  const resolutionSeconds = ticket.resolved_at
    ? Math.floor(
        (new Date(ticket.resolved_at) - new Date(ticket.last_reopened_at || ticket.created_at)) / 1000
      )
    : null;

  res.json({ ...ticket, messages, turnaroundTime, resolutionSeconds });
});

// PATCH /api/tickets/:id  -> update status / category / priority / assignee / notes / tags
router.patch("/:id", async (req, res) => {
  const { status, category, priority, assignee, notes, tags } = req.body;

  const { rows: current } = await pool.query("SELECT * FROM tickets WHERE id = $1", [
    req.params.id,
  ]);
  if (!current[0]) return res.status(404).json({ error: "not found" });
  const currentTicket = current[0];

  // Server-side enforcement of the core rule: can't close an unresolved ticket.
  if (status === "closed" && currentTicket.status !== "resolved") {
    return res
      .status(400)
      .json({ error: "Ticket must be marked resolved before it can be closed." });
  }

  // Track exactly when a ticket becomes resolved, and clear it if it's
  // ever moved to a non-resolved, non-closed state again (a real reopen).
  let resolvedAtUpdate; // undefined = don't touch the column
  let lastReopenedAtUpdate;
  if (status === "resolved" && currentTicket.status !== "resolved") {
    resolvedAtUpdate = new Date();
  } else if (status && !["resolved", "closed"].includes(status) && currentTicket.resolved_at) {
    resolvedAtUpdate = null; // clears it back to NULL
    lastReopenedAtUpdate = new Date();
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
  if (resolvedAtUpdate !== undefined) {
    params.push(resolvedAtUpdate);
    sets.push(`resolved_at = $${params.length}`);
  }
  if (lastReopenedAtUpdate !== undefined) {
    params.push(lastReopenedAtUpdate);
    sets.push(`last_reopened_at = $${params.length}`);
  }
  // An agent explicitly setting category or priority is a deliberate human
  // decision -- the AI classifier should stop touching this ticket from
  // here on, so it never fights that decision on the next inbound message.
  if (category !== undefined || priority !== undefined) {
    sets.push(`manually_classified = true`);
  }
  if (!sets.length) return res.status(400).json({ error: "no fields to update" });

  params.push(req.params.id);
  const { rows } = await pool.query(
    `UPDATE tickets SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`,
    params
  );
  res.json(rows[0]);
});

// POST /api/tickets/:id/reply  -> agent reply (text or media), sent out over WhatsApp via Whapi
router.post("/:id/reply", upload.single("file"), async (req, res) => {
  const { body } = req.body;
  const file = req.file;

  const { rows } = await pool.query("SELECT * FROM tickets WHERE id = $1", [req.params.id]);
  const ticket = rows[0];
  if (!ticket) return res.status(404).json({ error: "not found" });

  try {
    if (file) {
      const mediaType = file.mimetype.startsWith("image/")
        ? "image"
        : file.mimetype.startsWith("video/")
        ? "video"
        : file.mimetype.startsWith("audio/")
        ? req.body.isVoiceNote === "true"
          ? "voice"
          : "audio"
        : "document";

      const dataUri = `data:${file.mimetype};name=${file.originalname};base64,${file.buffer.toString(
        "base64"
      )}`;
      const whapiRes = await sendMedia(ticket.student_phone, mediaType, dataUri, {
        caption: body,
        filename: file.originalname,
      });
      await addMessage(ticket.id, "outbound", {
        messageType: mediaType,
        body: body || null,
        mimeType: file.mimetype,
        filename: file.originalname,
        caption: body || null,
        whapiMessageId: whapiRes?.message?.id || null,
      });
    } else {
      if (!body || !body.trim()) return res.status(400).json({ error: "body is required" });
      const whapiRes = await sendText(ticket.student_phone, body);
      await addMessage(ticket.id, "outbound", {
        messageType: "text",
        body,
        whapiMessageId: whapiRes?.message?.id || null,
      });
    }

    if (ticket.status === "new") {
      await pool.query(`UPDATE tickets SET status = 'open' WHERE id = $1`, [ticket.id]);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("Reply send error:", err);
    res.status(502).json({ error: "failed to send message via Whapi" });
  }
});

export default router;
