-- Threadline schema: tickets + messages
-- Run with: psql "$DATABASE_URL" -f src/schema.sql

CREATE TABLE IF NOT EXISTS tickets (
  id               SERIAL PRIMARY KEY,
  ticket_no        TEXT UNIQUE,
  student_phone    TEXT NOT NULL,
  student_name     TEXT,
  status           TEXT NOT NULL DEFAULT 'new'
                     CHECK (status IN ('new', 'open', 'pending', 'resolved', 'closed')),
  category         TEXT NOT NULL DEFAULT 'general',
  priority         TEXT NOT NULL DEFAULT 'medium'
                     CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  assignee         TEXT,
  tags             TEXT[] NOT NULL DEFAULT '{}',
  notes            TEXT NOT NULL DEFAULT '',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at      TIMESTAMPTZ,
  last_reopened_at TIMESTAMPTZ,
  manually_classified BOOLEAN NOT NULL DEFAULT false,
  previous_ticket_id INTEGER REFERENCES tickets(id)
);

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS last_reopened_at TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS manually_classified BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS previous_ticket_id INTEGER REFERENCES tickets(id);

CREATE INDEX IF NOT EXISTS idx_tickets_phone  ON tickets (student_phone);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets (status);

CREATE TABLE IF NOT EXISTS messages (
  id                SERIAL PRIMARY KEY,
  ticket_id         INTEGER NOT NULL REFERENCES tickets (id) ON DELETE CASCADE,
  direction         TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  message_type      TEXT NOT NULL DEFAULT 'text'
                      CHECK (message_type IN ('text', 'image', 'video', 'document', 'audio', 'voice', 'sticker')),
  body              TEXT,
  media_url         TEXT,
  mime_type         TEXT,
  filename          TEXT,
  caption           TEXT,
  whapi_message_id  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  pinned            BOOLEAN NOT NULL DEFAULT false,
  starred           BOOLEAN NOT NULL DEFAULT false,
  deleted_at        TIMESTAMPTZ,
  reaction          TEXT,
  quoted_message_id INTEGER REFERENCES messages(id),
  delivery_status   TEXT DEFAULT 'sent'
);

-- Migration for pre-existing tables (safe to re-run: only adds what's missing)
ALTER TABLE messages ADD COLUMN IF NOT EXISTS message_type TEXT NOT NULL DEFAULT 'text';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_url TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS mime_type TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS filename TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS caption TEXT;
ALTER TABLE messages ALTER COLUMN body DROP NOT NULL;
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_message_type_check;
ALTER TABLE messages ADD CONSTRAINT messages_message_type_check
  CHECK (message_type IN ('text', 'image', 'video', 'document', 'audio', 'voice', 'sticker'));
ALTER TABLE messages ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS starred BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reaction TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS quoted_message_id INTEGER REFERENCES messages(id);
ALTER TABLE messages ADD COLUMN IF NOT EXISTS delivery_status TEXT DEFAULT 'sent';

CREATE INDEX IF NOT EXISTS idx_messages_ticket ON messages (ticket_id);

-- Keep updated_at current on every change
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tickets_updated_at ON tickets;
CREATE TRIGGER trg_tickets_updated_at
  BEFORE UPDATE ON tickets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Holidays for TAT working-hours calculations (see docs/TAT.md). Dates are
-- IST calendar dates. Sundays are already non-working and needn't be listed.
CREATE TABLE IF NOT EXISTS holidays (
  holiday_date DATE PRIMARY KEY,
  name         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Speeds up "first agent reply after the ticket was created" lookups used by TAT reports
CREATE INDEX IF NOT EXISTS idx_messages_ticket_dir_created ON messages (ticket_id, direction, created_at);

-- Every status change, so time spent in each status (e.g. Pending) can be
-- measured. Written by src/services/status.js -- see docs/STATUSES.md.
CREATE TABLE IF NOT EXISTS ticket_status_events (
  id           SERIAL PRIMARY KEY,
  ticket_id    INTEGER NOT NULL REFERENCES tickets (id) ON DELETE CASCADE,
  from_status  TEXT,
  to_status    TEXT NOT NULL,
  reason       TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_status_events_ticket ON ticket_status_events (ticket_id, created_at);

-- Tickets from before status history existed get one starting event, so
-- every ticket has at least one. Only touches tickets with no events.
INSERT INTO ticket_status_events (ticket_id, from_status, to_status, reason, created_at)
SELECT t.id, NULL, t.status, 'backfill',
       CASE WHEN t.status = 'new' THEN t.created_at ELSE t.updated_at END
FROM tickets t
WHERE NOT EXISTS (SELECT 1 FROM ticket_status_events e WHERE e.ticket_id = t.id);
