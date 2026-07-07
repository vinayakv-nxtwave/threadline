import { pool } from "../db.js";

export function normalizePhone(raw) {
  return String(raw).replace(/\D/g, "");
}

export async function findLatestTicketByPhone(phone) {
  const { rows } = await pool.query(
    `SELECT * FROM tickets WHERE student_phone = $1 ORDER BY created_at DESC LIMIT 1`,
    [phone]
  );
  return rows[0] || null;
}

const CATEGORY_KEYWORDS = [
  { category: "certificate", pattern: /\b(certificate|placement)\b/ },
  { category: "payment", pattern: /\b(emi|payment|refund|fee|fees|invoice)\b/ },
  { category: "session", pattern: /\b(live class|live session|mentor|webinar)\b/ },
  { category: "access", pattern: /\b(password|log ?in|account access|otp|locked out)\b/ },
  { category: "doubt", pattern: /\b(doubt|explain|understand|concept|assignment)\b/ },
  { category: "technical", pattern: /\b(not working|error|bug|crash|video|buffering|link)\b/ },
];

/**
 * Scans the student's first message for keywords to pick a sensible starting
 * category/priority, so new tickets aren't all dumped into "general/medium".
 * Agents can always override afterward.
 */
export function classifyMessage(text) {
  const lower = String(text || "").toLowerCase();

  let priority = "medium";
  const exclaims = (lower.match(/!/g) || []).length;
  if (/\burgent(ly)?\b|\b(asap|emergency|immediately|right now)\b/.test(lower) || exclaims >= 2) {
    priority = "urgent";
  } else if (/\b(important|quick|quickly|soon)\b/.test(lower)) {
    priority = "high";
  }

  const category = CATEGORY_KEYWORDS.find((rule) => rule.pattern.test(lower))?.category || "general";

  return { category, priority };
}

export async function createTicket({ phone, name, text }) {
  const { category, priority } = classifyMessage(text);
  const { rows } = await pool.query(
    `INSERT INTO tickets (student_phone, student_name, status, category, priority)
     VALUES ($1, $2, 'new', $3, $4)
     RETURNING *`,
    [phone, name || null, category, priority]
  );
  const ticket = rows[0];

  // Human-friendly ticket number, generated from the row id once we have it.
  const ticketNo = `LP-${2000 + ticket.id}`;
  const { rows: updated } = await pool.query(
    `UPDATE tickets SET ticket_no = $1 WHERE id = $2 RETURNING *`,
    [ticketNo, ticket.id]
  );
  return updated[0];
}

export async function addMessage(
  ticketId,
  direction,
  {
    messageType = "text",
    body = null,
    mediaUrl = null,
    mimeType = null,
    filename = null,
    caption = null,
    whapiMessageId = null,
  }
) {
  await pool.query(
    `INSERT INTO messages (ticket_id, direction, message_type, body, media_url, mime_type, filename, caption, whapi_message_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [ticketId, direction, messageType, body, mediaUrl, mimeType, filename, caption, whapiMessageId]
  );
  await pool.query(`UPDATE tickets SET last_message_at = now() WHERE id = $1`, [ticketId]);
}

/**
 * The core rule: a ticket cannot sit closed or resolved once the student has
 * something new to say. If the student messages in on a resolved/closed
 * ticket, it snaps back open — treated as a new query, so category/priority
 * are re-classified from this message same as a brand new ticket. If they
 * message on a "pending" ticket (waiting on them), it's a continuation of
 * the same query, so it just moves to "open" (waiting on us again) without
 * touching classification.
 * Returns true if the ticket was reopened from resolved/closed.
 */
export async function reopenIfNeeded(ticket, text) {
  if (ticket.status === "resolved" || ticket.status === "closed") {
    const { category, priority } = classifyMessage(text);
    await pool.query(
      `UPDATE tickets SET status = 'open', category = $2, priority = $3 WHERE id = $1`,
      [ticket.id, category, priority]
    );
    return true;
  }
  if (ticket.status === "pending") {
    await pool.query(`UPDATE tickets SET status = 'open' WHERE id = $1`, [ticket.id]);
  }
  return false;
}

/**
 * Entry point called by the webhook route for every inbound student message.
 * Finds or creates the ticket for this phone number, reopens it if needed,
 * and logs the message.
 */
export async function handleIncomingMessage({
  phone,
  name,
  type = "text",
  text,
  mediaUrl,
  mimeType,
  filename,
  caption,
  whapiMessageId,
}) {
  const normalizedPhone = normalizePhone(phone);
  let ticket = await findLatestTicketByPhone(normalizedPhone);
  let reopened = false;
  const classifyText = text ?? caption ?? "";

  if (!ticket) {
    ticket = await createTicket({ phone: normalizedPhone, name, text: classifyText });
  } else {
    reopened = await reopenIfNeeded(ticket, classifyText);
    if (!ticket.student_name && name) {
      await pool.query(`UPDATE tickets SET student_name = $1 WHERE id = $2`, [name, ticket.id]);
    }
  }

  await addMessage(ticket.id, "inbound", {
    messageType: type,
    body: text ?? caption ?? null,
    mediaUrl,
    mimeType,
    filename,
    caption,
    whapiMessageId,
  });

  return { ticket, reopened };
}
