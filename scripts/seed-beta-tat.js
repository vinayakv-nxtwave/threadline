// Seeds TAT test scenarios into the BETA database so the TAT Reports screen
// can be checked by eye against known answers.
//
//   APP_ENV=beta DATABASE_URL="<beta Neon URL>" node scripts/seed-beta-tat.js
//
// Scenarios are placed in the Mon-Sat week starting two Mondays ago, so every
// outcome is final by now. Each ticket's notes say what the dashboard should
// show for it. Re-running replaces the previous seed (phones 91999000xxxx).

import { IS_BETA } from "../src/env.js";
import { localDateKey, bucketKeyForDate } from "../src/services/tat.js";

if (!IS_BETA) {
  console.error("Refusing to run: APP_ENV is not 'beta'. This script must never touch the production database.");
  process.exit(1);
}

const { pool } = await import("../src/db.js");
console.log(`Seeding TAT scenarios into ${new URL(process.env.DATABASE_URL).hostname} (APP_ENV=beta)`);

const DAY = 86400000;
const thisMonday = bucketKeyForDate(localDateKey(new Date()), "week");
const W = new Date(Date.parse(`${thisMonday}T00:00:00Z`) - 14 * DAY); // Monday, two weeks back
const dayKey = (offset) => new Date(W.getTime() + offset * DAY).toISOString().slice(0, 10);
// at(0, "10:00") = that Monday 10:00 IST; at(7, ...) = the following Monday
const at = (offset, hhmm) => new Date(`${dayKey(offset)}T${hhmm}:00+05:30`);
const label = (offset, hhmm) =>
  `${new Date(`${dayKey(offset)}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })} ${hhmm}`;

const HOLIDAY = { date: dayKey(4), name: "TAT TEST holiday (seed)" }; // the Friday

// [code, received, firstReply, resolved, status, expectation]
const S = [
  ["S1", [0, "10:00"], [0, "12:30"], [1, "15:00"], "resolved",
    "Response WITHIN TAT (due Mon 13:00). Resolution WITHIN TAT (due Wed 18:00)."],
  ["S2", [0, "16:00"], [1, "11:00"], [3, "16:00"], "resolved",
    "Response WITHIN TAT - replied exactly at deadline Tue 11:00. Resolution WITHIN TAT - exactly at deadline Thu 16:00."],
  ["S3", [0, "16:00"], [1, "11:01"], [3, "16:01"], "resolved",
    "Response BREACHED - 1 min late (due Tue 11:00). Resolution BREACHED - 1 min late (due Thu 16:00)."],
  ["S4", [0, "21:00"], [1, "12:00"], null, "pending",
    "AFTER-HOURS (clock starts Tue 10:00). Response WITHIN TAT (due Tue 13:00). Resolution BREACHED - never resolved (due Thu 18:00)."],
  ["S5", [2, "15:00"], null, null, "new",
    "Response BREACHED - never replied (due Wed 18:00). In 'Pending at close' every working day since."],
  ["S6", [2, "10:00"], [2, "10:20"], [2, "17:00"], "resolved",
    "Response WITHIN TAT. Resolution WITHIN TAT."],
  ["S7", [3, "17:00"], [5, "11:30"], null, "pending",
    "HOLIDAY: Fri is a seeded holiday, so response is due Sat 12:00 (Thu 1h + Sat 2h) -> WITHIN TAT. Without the holiday it would be breached."],
  ["S8", [5, "16:00"], [7, "10:45"], null, "pending",
    "SATURDAY works, Sunday doesn't: response due next Mon 11:00 (Sat 2h + Mon 1h) -> WITHIN TAT."],
  ["S9", [6, "12:00"], [7, "13:30"], null, "pending",
    "SUNDAY query = AFTER-HOURS, clock starts Mon 10:00, due Mon 13:00 -> response BREACHED (30 min late)."],
  ["S10", [0, "09:30"], [0, "09:45"], [0, "11:00"], "resolved",
    "Before-hours query answered before 10:00 -> response WITHIN TAT with 0 working minutes."],
];

const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query(`DELETE FROM tickets WHERE student_phone LIKE '91999000%'`);
  await client.query(`DELETE FROM holidays WHERE name = $1`, [HOLIDAY.name]);
  await client.query(`INSERT INTO holidays (holiday_date, name) VALUES ($1, $2) ON CONFLICT (holiday_date) DO NOTHING`, [
    HOLIDAY.date,
    HOLIDAY.name,
  ]);

  for (const [i, [code, rec, reply, resolved, status, expect]] of S.entries()) {
    const receivedAt = at(...rec);
    const { rows } = await client.query(
      `INSERT INTO tickets (student_phone, student_name, status, created_at, last_message_at, resolved_at, notes, manually_classified)
       VALUES ($1, $2, $3, $4, $4, $5, $6, true) RETURNING id`,
      [
        `91999000${String(i + 1).padStart(4, "0")}`,
        `TAT ${code} · ${label(...rec)}`,
        status,
        receivedAt,
        resolved ? at(...resolved) : null,
        `[TAT seed ${code}] EXPECTED: ${expect}`,
      ]
    );
    const id = rows[0].id;
    await client.query(`UPDATE tickets SET ticket_no = $1 WHERE id = $2`, [`LP-${2000 + id}`, id]);
    await client.query(
      `INSERT INTO messages (ticket_id, direction, body, created_at) VALUES ($1, 'inbound', $2, $3)`,
      [id, `[${code}] Test query received ${label(...rec)}`, receivedAt]
    );
    if (reply) {
      await client.query(
        `INSERT INTO messages (ticket_id, direction, body, created_at) VALUES ($1, 'outbound', $2, $3)`,
        [id, `[${code}] Agent reply ${label(...reply)}`, at(...reply)]
      );
      await client.query(`UPDATE tickets SET last_message_at = $1 WHERE id = $2`, [at(...reply), id]);
    }
    // Status history, following the 4-status rules (docs/STATUSES.md)
    const events = [[null, "new", receivedAt]];
    if (reply) events.push(["new", "pending", at(...reply)]);
    if (resolved) events.push([reply ? "pending" : "new", "resolved", at(...resolved)]);
    for (const [from, to, when] of events) {
      await client.query(
        `INSERT INTO ticket_status_events (ticket_id, from_status, to_status, reason, created_at)
         VALUES ($1, $2, $3, 'seed', $4)`,
        [id, from, to, when]
      );
    }
    console.log(`  LP-${2000 + id}  ${code.padEnd(4)} ${label(...rec).padEnd(16)} ${expect}`);
  }
  await client.query("COMMIT");
  console.log(`\nHoliday seeded: ${HOLIDAY.date} (${HOLIDAY.name})`);
  console.log(`Open TAT Reports -> Daily, range ${dayKey(0)} to ${dayKey(7)}, and compare with the notes above.`);
} catch (err) {
  await client.query("ROLLBACK");
  throw err;
} finally {
  client.release();
  await pool.end();
}
