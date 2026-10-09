import { pool } from "../db.js";

// Holidays are read on every inbox poll (every few seconds per open
// dashboard), so keep a short in-memory cache; writes clear it immediately.
const CACHE_MS = 60 * 1000;
let cache = null;
let cachedAt = 0;

/**
 * @returns {Promise<{ rows: {date: string, name: string}[], dates: Set<string>, missingTable: boolean }>}
 * missingTable is true when schema.sql hasn't been run on this database yet --
 * callers decide whether that's fatal (TAT report) or tolerable (inbox).
 */
export async function loadHolidays() {
  if (cache && Date.now() - cachedAt < CACHE_MS) return cache;
  try {
    // to_char, not the raw DATE: pg turns DATE into a JS Date at *server-local*
    // midnight, which shifts the day depending on the host's timezone.
    const { rows } = await pool.query(
      `SELECT to_char(holiday_date, 'YYYY-MM-DD') AS date, name FROM holidays ORDER BY holiday_date`
    );
    cache = { rows, dates: new Set(rows.map((r) => r.date)), missingTable: false };
  } catch (err) {
    if (err.code !== "42P01") throw err; // 42P01 = undefined_table
    console.error("holidays table missing -- run src/schema.sql against this database");
    return { rows: [], dates: new Set(), missingTable: true };
  }
  cachedAt = Date.now();
  return cache;
}

export function clearHolidayCache() {
  cache = null;
}
