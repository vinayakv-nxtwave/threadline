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
  last_message_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

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
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
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
