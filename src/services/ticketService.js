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

export async function createTicket({ phone, name }) {
  const { rows } = await pool.query(
    `INSERT INTO tickets (student_phone, student_name, status, category, priority)
     VALUES ($1, $2, 'new', 'general', 'medium')
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

export async function addMessage(ticketId, direction, body, whapiMessageId = null) {
  await pool.query(
    `INSERT INTO messages (ticket_id, direction, body, whapi_message_id)
     VALUES ($1, $2, $3, $4)`,
    [ticketId, direction, body, whapiMessageId]
  );
  await pool.query(`UPDATE tickets SET last_message_at = now() WHERE id = $1`, [ticketId]);
}

/**
 * The core rule: a ticket cannot sit closed or resolved once the student has
 * something new to say. If the student messages in on a resolved/closed
 * ticket, it snaps back open. If they message on a "pending" ticket
 * (waiting on them), it moves to "open" (waiting on us again).
 * Returns true if the ticket was reopened from resolved/closed.
 */
export async function reopenIfNeeded(ticket) {
  if (ticket.status === "resolved" || ticket.status === "closed") {
    await pool.query(`UPDATE tickets SET status = 'open' WHERE id = $1`, [ticket.id]);
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
export async function handleIncomingMessage({ phone, name, text, whapiMessageId }) {
  const normalizedPhone = normalizePhone(phone);
  let ticket = await findLatestTicketByPhone(normalizedPhone);
  let reopened = false;

  if (!ticket) {
    ticket = await createTicket({ phone: normalizedPhone, name });
  } else {
    reopened = await reopenIfNeeded(ticket);
    if (!ticket.student_name && name) {
      await pool.query(`UPDATE tickets SET student_name = $1 WHERE id = $2`, [name, ticket.id]);
    }
  }

  await addMessage(ticket.id, "inbound", text, whapiMessageId);

  return { ticket, reopened };
}
