import { pool } from "../db.js";
import { classifyTicket } from "./classifier.js";

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

export async function createTicket({ phone, name }) {
  const { rows } = await pool.query(
    `INSERT INTO tickets (student_phone, student_name, status)
     VALUES ($1, $2, 'new')
     RETURNING *`,
    [phone, name || null]
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
    quotedMessageId = null,
  }
) {
  const { rows } = await pool.query(
    `INSERT INTO messages (ticket_id, direction, message_type, body, media_url, mime_type, filename, caption, whapi_message_id, quoted_message_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [ticketId, direction, messageType, body, mediaUrl, mimeType, filename, caption, whapiMessageId, quotedMessageId]
  );
  await pool.query(`UPDATE tickets SET last_message_at = now() WHERE id = $1`, [ticketId]);
  return rows[0];
}

/**
 * Looks up a message's local row by its whapi_message_id -- used to resolve
 * quoted-reply references and incoming reactions back to a local message id.
 */
export async function findMessageByWhapiId(whapiMessageId) {
  if (!whapiMessageId) return null;
  const { rows } = await pool.query(`SELECT * FROM messages WHERE whapi_message_id = $1 LIMIT 1`, [whapiMessageId]);
  return rows[0] || null;
}

/**
 * Applies an incoming reaction (from the student's WhatsApp app) to the
 * local message it targets, looked up by whapi_message_id.
 */
export async function applyIncomingReaction(targetWhapiMessageId, emoji) {
  await pool.query(`UPDATE messages SET reaction = $1 WHERE whapi_message_id = $2`, [
    emoji || null,
    targetWhapiMessageId,
  ]);
}

/**
 * No longer called from the webhook flow -- handleIncomingMessage now starts
 * a fresh ticket instead of reopening a resolved/closed one (see
 * previous_ticket_id). Kept as-is for the manual-reopen case, though
 * PATCH /:id currently has its own separate inline logic rather than
 * calling this directly.
 */
export async function reopenIfNeeded(ticket) {
  if (ticket.status === "resolved" || ticket.status === "closed") {
    await pool.query(
      `UPDATE tickets
       SET status = 'open', resolved_at = NULL, last_reopened_at = now()
       WHERE id = $1`,
      [ticket.id]
    );
    return true;
  }
  if (ticket.status === "pending") {
    await pool.query(`UPDATE tickets SET status = 'open' WHERE id = $1`, [ticket.id]);
  }
  return false;
}

/**
 * Turnaround time for a ticket: the gap between when it most recently opened
 * (original creation, or the last reopen) and the first agent reply after
 * that point — same anchor point resolution time uses, for consistency. If
 * there's no reply yet in this cycle, returns how long the student has been
 * waiting so far instead of a fixed duration.
 */
export async function getTurnaroundTime(ticketId) {
  const { rows } = await pool.query(
    `WITH ref AS (
       SELECT COALESCE(last_reopened_at, created_at) AS opened_at
       FROM tickets WHERE id = $1
     ),
     first_reply AS (
       SELECT MIN(m.created_at) AS reply_at
       FROM messages m, ref r
       WHERE m.ticket_id = $1 AND m.direction = 'outbound' AND m.created_at > r.opened_at
     )
     SELECT ref.opened_at, first_reply.reply_at FROM ref, first_reply`,
    [ticketId]
  );
  const row = rows[0];
  if (!row || !row.opened_at) return { status: "no_data" };
  if (!row.reply_at) {
    return {
      status: "awaiting_reply",
      waitingSeconds: Math.max(0, Math.floor((Date.now() - new Date(row.opened_at)) / 1000)),
    };
  }
  return {
    status: "replied",
    turnaroundSeconds: Math.floor((new Date(row.reply_at) - new Date(row.opened_at)) / 1000),
  };
}

/**
 * Entry point called by the webhook route for every inbound student message.
 * Finds the student's latest ticket; if it's resolved/closed, starts a
 * fresh ticket instead of reopening it (linked via previous_ticket_id) so a
 * new query never gets mixed into an old, finished conversation. Manual
 * reopens (agent flips status back to open in the dashboard) are handled
 * separately in PATCH /:id and are unaffected by this.
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
  quotedMessageId,
}) {
  const normalizedPhone = normalizePhone(phone);
  let ticket = await findLatestTicketByPhone(normalizedPhone);
  let newTicketCreated = false;

  if (!ticket) {
    ticket = await createTicket({ phone: normalizedPhone, name });
    newTicketCreated = true;
  } else if (["resolved", "closed"].includes(ticket.status)) {
    // The most recent ticket for this student is finished. Treat this as a
    // genuinely new query rather than reopening old, resolved history.
    const previousTicketId = ticket.id;
    ticket = await createTicket({ phone: normalizedPhone, name });
    await pool.query(`UPDATE tickets SET previous_ticket_id = $1 WHERE id = $2`, [previousTicketId, ticket.id]);
    ticket.previous_ticket_id = previousTicketId;
    newTicketCreated = true;
  } else if (ticket.status === "pending") {
    // Still the same open issue, just waiting on the student -- their reply
    // moves it back to "open", no new ticket needed.
    await pool.query(`UPDATE tickets SET status = 'open' WHERE id = $1`, [ticket.id]);
  }
  // status "new" or "open": no change needed, just log the message below

  if (!newTicketCreated && !ticket.student_name && name) {
    await pool.query(`UPDATE tickets SET student_name = $1 WHERE id = $2`, [name, ticket.id]);
  }

  await addMessage(ticket.id, "inbound", {
    messageType: type,
    body: text ?? caption ?? null,
    mediaUrl,
    mimeType,
    filename,
    caption,
    whapiMessageId,
    quotedMessageId,
  });

  if (!ticket.manually_classified) {
    const { rows: allMessages } = await pool.query(
      `SELECT direction, body FROM messages WHERE ticket_id = $1 ORDER BY created_at ASC`,
      [ticket.id]
    );
    const classification = await classifyTicket(allMessages);
    if (classification) {
      await pool.query(`UPDATE tickets SET category = $1, priority = $2 WHERE id = $3`, [
        classification.category,
        classification.priority,
        ticket.id,
      ]);
    }
  }

  return { ticket, newTicketCreated };
}

/**
 * Entry point for messages an agent sends directly from the connected
 * WhatsApp phone (not through the CRM's /reply endpoint). Whapi reports
 * these as from_me: true webhook events. Logs them as outbound on the
 * matching ticket, deduping against the echo of a CRM-sent reply.
 */
export async function logAgentMessageFromPhone({
  phone,
  type,
  text,
  mediaUrl,
  mimeType,
  filename,
  caption,
  whapiMessageId,
}) {
  const normalizedPhone = normalizePhone(phone);
  const ticket = await findLatestTicketByPhone(normalizedPhone);
  if (!ticket) return null; // no matching ticket, nothing to attach this to

  // Skip if this exact message was already logged (e.g. sent via the CRM's
  // own /reply endpoint, which Whapi then echoes back as from_me:true).
  const { rows } = await pool.query(
    `SELECT 1 FROM messages WHERE whapi_message_id = $1 LIMIT 1`,
    [whapiMessageId]
  );
  if (rows.length) return ticket;

  await addMessage(ticket.id, "outbound", {
    messageType: type,
    body: text ?? caption ?? null,
    mediaUrl,
    mimeType,
    filename,
    caption,
    whapiMessageId,
  });

  if (ticket.status === "new") {
    await pool.query(`UPDATE tickets SET status = 'open' WHERE id = $1`, [ticket.id]);
  }

  return ticket;
}
