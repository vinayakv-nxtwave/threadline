import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

const needsSSL = /supabase\.co|render\.com|neon\.tech|amazonaws\.com/.test(
  process.env.DATABASE_URL || ""
);

// Parse the URL ourselves so we can pass user/password as separate fields.
// This avoids a bug in older `pg` versions where a "." in the username
// (e.g. Supabase pooler users like "postgres.abcxyz") gets truncated.
const url = new URL(process.env.DATABASE_URL);

export const pool = new Pool({
  host: url.hostname,
  port: Number(url.port || 5432),
  database: url.pathname.slice(1),
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  ssl: needsSSL ? { rejectUnauthorized: false } : undefined,
});