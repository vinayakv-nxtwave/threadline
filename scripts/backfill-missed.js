// Finds WhatsApp messages that never reached the database (webhook missed
// them) and, with --apply, imports them with their original timestamps.
//
//   node scripts/backfill-missed.js --days 30            # dry run: report only
//   node scripts/backfill-missed.js --days 30 --apply    # import them
//
// Uses DATABASE_URL + WHAPI_TOKEN from the environment / .env (production).
// Re-running is safe: messages already stored are skipped. Prints no message
// text -- only counts, types, dates and masked phone numbers.

import { IS_BETA } from "../src/env.js";
import { listMessages } from "../src/services/whapiClient.js";
import { normalizeWhapiMessage } from "../src/services/whapiMessage.js";

const args = process.argv.slice(2);
const days = Number(args[args.indexOf("--days") + 1]) || 7;
const apply = args.includes("--apply");

if (IS_BETA) {
  console.error("Refusing to run with APP_ENV=beta: beta has no WhatsApp channel.");
  process.exit(1);
}

const { pool } = await import("../src/db.js");
console.log(`Database: ${new URL(process.env.DATABASE_URL).hostname}`);
console.log(`Window: last ${days} day(s) · mode: ${apply ? "APPLY (will import)" : "dry run (no changes)"}\n`);

const since = Math.floor(Date.now() / 1000) - days * 86400;
const raw = await listMessages(since);

const candidates = [];
for (const msg of raw) {
  const m = normalizeWhapiMessage(msg);
  if (m.kind !== "message") continue;
  candidates.push({ msg, m });
}
const ids = candidates.map((c) => c.m.whapiMessageId);
const { rows } = await pool.query(`SELECT whapi_message_id FROM messages WHERE whapi_message_id = ANY($1)`, [ids]);
const stored = new Set(rows.map((r) => r.whapi_message_id));
const missing = candidates.filter((c) => !stored.has(c.m.whapiMessageId));

const ist = (d) => new Date(d.getTime() + 330 * 60000).toISOString().replace("T", " ").slice(0, 16);
const mask = (p) => (p.length > 4 ? `${"•".repeat(p.length - 4)}${p.slice(-4)}` : p);
const fromStudents = missing.filter((c) => !c.m.fromMe);
const fromUs = missing.filter((c) => c.m.fromMe);
console.log(`Channel messages scanned: ${raw.length}`);
console.log(`Missing from the database: ${missing.length}  (from students: ${fromStudents.length}, our replies from the phone: ${fromUs.length})\n`);
for (const { msg, m } of missing.sort((a, b) => a.m.receivedAt - b.m.receivedAt)) {
  console.log(`  ${ist(m.receivedAt)} IST  ${m.fromMe ? "us     " : "student"}  ${mask(m.phone)}  ${msg.type}`);
}

if (!apply) {
  console.log("\nDry run only. Re-run with --apply to import these.");
  await pool.end();
  process.exit(0);
}

const { syncSince } = await import("../src/services/whapiSync.js");
const counts = await syncSince(since);
console.log("\nImport done:", counts);
await pool.end();
process.exit(0);
