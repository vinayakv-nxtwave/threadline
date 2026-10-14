import { pool } from "../db.js";
import { TRANSITIONS, pendingTime } from "./statusRules.js";

/**
 * Applies one of the automatic transitions in statusRules.TRANSITIONS.
 * Atomic: the status only changes if the ticket is still in one of the
 * `from` statuses at the moment of the update, so two agents (or a poll and
 * a click) can't race it into a wrong state. Returns the previous status if
 * it changed, otherwise null.
 */
export async function applyTransition(ticketId, event) {
  const t = TRANSITIONS[event];
  if (!t) throw new Error(`unknown status transition: ${event}`);
  return setStatus(ticketId, t.to, { from: t.from, reason: event });
}

/**
 * Sets a ticket's status and records it in ticket_status_events.
 * @param from  only change if the current status is one of these (null = any)
 */
export async function setStatus(ticketId, to, { from = null, reason }) {
  const { rows } = await pool.query(
    `WITH cur AS (SELECT id, status FROM tickets WHERE id = $1 FOR UPDATE)
     UPDATE tickets t SET status = $2
     FROM cur
     WHERE t.id = cur.id AND cur.status <> $2 AND ($3::text[] IS NULL OR cur.status = ANY($3))
     RETURNING cur.status AS from_status`,
    [ticketId, to, from]
  );
  if (!rows[0]) return null;
  await recordStatusEvent(ticketId, rows[0].from_status, to, reason);
  return rows[0].from_status;
}

export async function recordStatusEvent(ticketId, fromStatus, toStatus, reason, at = null) {
  await pool.query(
    `INSERT INTO ticket_status_events (ticket_id, from_status, to_status, reason, created_at)
     VALUES ($1, $2, $3, $4, COALESCE($5, now()))`,
    [ticketId, fromStatus, toStatus, reason, at]
  );
}

/** Status history for many tickets at once: Map(ticketId -> events oldest first). */
export async function loadStatusEvents(ticketIds) {
  const byTicket = new Map();
  if (!ticketIds.length) return byTicket;
  const { rows } = await pool.query(
    `SELECT ticket_id, from_status, to_status, reason, created_at
     FROM ticket_status_events WHERE ticket_id = ANY($1::int[])
     ORDER BY ticket_id, created_at, id`,
    [ticketIds]
  );
  for (const r of rows) {
    if (!byTicket.has(r.ticket_id)) byTicket.set(r.ticket_id, []);
    byTicket.get(r.ticket_id).push(r);
  }
  return byTicket;
}

/** Pending-time summary for each ticket id (see statusRules.pendingTime). */
export async function loadPendingTimes(ticketIds, holidays, now = new Date()) {
  const events = await loadStatusEvents(ticketIds);
  const out = new Map();
  for (const id of ticketIds) out.set(id, pendingTime(events.get(id) || [], now, { holidays }));
  return out;
}
