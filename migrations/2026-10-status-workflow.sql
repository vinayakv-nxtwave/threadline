-- ONE-OFF migration for the 4-status workflow (docs/STATUSES.md).
-- Run ONCE per database, AFTER src/schema.sql and AFTER the new code is
-- deployed there. Do NOT add this to schema.sql: re-running it later would
-- wrongly flip tickets an agent deliberately set back to Open.
--
--   psql "$DATABASE_URL" -f migrations/2026-10-status-workflow.sql
--
-- What it does:
--   1. "Closed" is retired: closed tickets become Resolved (resolved_at kept).
--   2. "Open" now means "opened, not yet replied". Open tickets that already
--      have an agent reply are, under the new rules, Pending.
-- Each change is recorded in ticket_status_events with reason 'migration'.

BEGIN;

WITH changed AS (
  UPDATE tickets SET status = 'resolved', resolved_at = COALESCE(resolved_at, updated_at)
  WHERE status = 'closed'
  RETURNING id
)
INSERT INTO ticket_status_events (ticket_id, from_status, to_status, reason)
SELECT id, 'closed', 'resolved', 'migration' FROM changed;

WITH changed AS (
  UPDATE tickets t SET status = 'pending'
  WHERE t.status = 'open'
    AND EXISTS (SELECT 1 FROM messages m
                WHERE m.ticket_id = t.id AND m.direction = 'outbound' AND m.created_at >= t.created_at)
  RETURNING t.id
)
INSERT INTO ticket_status_events (ticket_id, from_status, to_status, reason)
SELECT id, 'open', 'pending', 'migration' FROM changed;

COMMIT;
