-- Company holidays used by TAT working-hours calculations (see docs/TAT.md).
-- No TAT time counts on these dates. Sundays are always off -- don't list them.
--
-- Run after schema.sql, on beta and on prod:
--   psql "$DATABASE_URL" -f src/holidays.sql
-- (or paste into the Neon SQL Editor). Safe to re-run: existing dates are
-- left as they are, so holidays added/renamed in the dashboard aren't undone.
-- To add a year's holidays, append rows here so every environment stays in sync.

INSERT INTO holidays (holiday_date, name) VALUES
  ('2026-10-21', 'Next Day Of Vijaya Dasami / Dussehra'),  -- Wed
  ('2026-12-25', 'Christmas')                               -- Fri
ON CONFLICT (holiday_date) DO NOTHING;
