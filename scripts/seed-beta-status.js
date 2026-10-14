// Seeds one ticket per status case into the BETA database, so the 4-status
// workflow (docs/STATUSES.md) can be checked by eye -- and some of them
// clicked through live.
//
//   APP_ENV=beta DATABASE_URL="<beta Neon URL>" node scripts/seed-beta-status.js
//
// Times are relative to now. Each ticket's student name says which case it
// is, and its notes say what you should see and what to try. Re-running
// replaces the previous run (phones 91999100xxxx).

import { IS_BETA } from "../src/env.js";

if (!IS_BETA) {
  console.error("Refusing to run: APP_ENV is not 'beta'. This script must never touch the production database.");
  process.exit(1);
}

const { pool } = await import("../src/db.js");
console.log(`Seeding status cases into ${new URL(process.env.DATABASE_URL).hostname} (APP_ENV=beta)\n`);

const now = Date.now();
const ago = (minutes) => new Date(now - minutes * 60000);

// msgs: [minutesAgo, "in"|"out", text]; events: [minutesAgo, from, to, reason]
const CASES = [
  {
    code: "ST1",
    title: "New Ticket",
    status: "new",
    msgs: [[20, "in", "Hi, my live class link is not opening"]],
    events: [[20, null, "new", "student_message"]],
    expect: "Status NEW TICKET (no agent has opened it).",
    tryIt: "Click this chat -> status becomes OPEN immediately (no reply needed).",
  },
  {
    code: "ST2",
    title: "Open",
    status: "open",
    msgs: [[60, "in", "I was charged twice for my EMI"]],
    events: [[60, null, "new", "student_message"], [40, "new", "open", "agent_opened"]],
    expect: "Status OPEN (agent opened it 40 min ago, hasn't replied).",
    tryIt: "Send a reply -> status becomes PENDING.",
  },
  {
    code: "ST3",
    title: "Pending",
    status: "pending",
    msgs: [
      [180, "in", "My certificate still shows the wrong name"],
      [150, "out", "Thanks, I've raised this with the certificates team and will update you."],
    ],
    events: [[180, null, "new", "student_message"], [170, "new", "open", "agent_opened"], [150, "open", "pending", "agent_reply"]],
    expect: "Status PENDING since our reply 150 min ago. Inbox row shows the pause icon with time in Pending (working hours only).",
    tryIt: "Use 'Simulate student message' with this ticket's phone -> status STAYS PENDING.",
  },
  {
    code: "ST4",
    title: "Pending + student follow-up",
    status: "pending",
    msgs: [
      [300, "in", "Mentor session got cancelled, can I rebook?"],
      [280, "out", "Checking with the mentor team, will get back to you."],
      [90, "in", "Any update on this?"],
    ],
    events: [[300, null, "new", "student_message"], [290, "new", "open", "agent_opened"], [280, "open", "pending", "agent_reply"]],
    expect: "Status STILL PENDING even though the student sent 'Any update?' after our reply.",
    tryIt: "Mark as resolved -> status RESOLVED, resolution clock stops.",
  },
  {
    code: "ST5",
    title: "Resolved",
    status: "resolved",
    resolvedMinutesAgo: 30,
    msgs: [
      [240, "in", "Cannot log in to my account"],
      [220, "out", "Resetting your access now, one moment."],
      [35, "out", "Done - please try logging in again."],
    ],
    events: [
      [240, null, "new", "student_message"],
      [230, "new", "open", "agent_opened"],
      [220, "open", "pending", "agent_reply"],
      [30, "pending", "resolved", "agent_set"],
    ],
    expect: "Status RESOLVED. Details panel shows 'Was Pending for ...' and 'Resolved in ...'. No Close button any more.",
    tryIt: "Use 'Simulate student message' with this ticket's phone -> a NEW ticket (New Ticket) is created and linked; this one stays Resolved.",
  },
];

const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query(`DELETE FROM tickets WHERE student_phone LIKE '91999100%'`);
  for (const [i, c] of CASES.entries()) {
    const phone = `91999100${String(i + 1).padStart(4, "0")}`;
    const first = c.msgs[0][0];
    const last = c.msgs[c.msgs.length - 1][0];
    const { rows } = await client.query(
      `INSERT INTO tickets (student_phone, student_name, status, created_at, last_message_at, resolved_at, notes, manually_classified)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true) RETURNING id`,
      [
        phone,
        `${c.code} · ${c.title}`,
        c.status,
        ago(first),
        ago(last),
        c.resolvedMinutesAgo != null ? ago(c.resolvedMinutesAgo) : null,
        `[Status seed ${c.code}] EXPECTED: ${c.expect}\nTRY: ${c.tryIt}`,
      ]
    );
    const id = rows[0].id;
    await client.query(`UPDATE tickets SET ticket_no = $1 WHERE id = $2`, [`LP-${2000 + id}`, id]);
    for (const [m, dir, body] of c.msgs) {
      await client.query(`INSERT INTO messages (ticket_id, direction, body, created_at) VALUES ($1, $2, $3, $4)`, [
        id,
        dir === "in" ? "inbound" : "outbound",
        body,
        ago(m),
      ]);
    }
    for (const [m, from, to, reason] of c.events) {
      await client.query(
        `INSERT INTO ticket_status_events (ticket_id, from_status, to_status, reason, created_at) VALUES ($1, $2, $3, $4, $5)`,
        [id, from, to, reason, ago(m)]
      );
    }
    console.log(`LP-${2000 + id}  ${c.code} ${c.title.padEnd(28)} phone ${phone}`);
    console.log(`         EXPECTED: ${c.expect}`);
    console.log(`         TRY:      ${c.tryIt}\n`);
  }
  await client.query("COMMIT");
} catch (err) {
  await client.query("ROLLBACK");
  throw err;
} finally {
  client.release();
  await pool.end();
}
