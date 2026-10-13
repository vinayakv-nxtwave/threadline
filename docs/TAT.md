# TAT (turnaround time) rules

These are the exact rules the dashboard uses. The code is `src/services/tat.js`, and every rule below has a test in `tests/tat.test.js` (`npm test`).

## Settings

| | Value |
|---|---|
| Working hours | **10:00–18:00 IST** (8 hours a day) |
| Working days | **Monday–Saturday** (Sunday is off) |
| Holidays | The company list lives in `src/holidays.sql` (run it on each database). One-off holidays can also be added in the dashboard (**TAT Reports → Holidays**). No TAT time counts on a holiday. |
| Response TAT | **3 working hours** |
| Resolution TAT | **24 working hours = 3 full working days** |

All values are in `TAT_CONFIG` at the top of `src/services/tat.js`. Change them there and update the tests to match.

## Definitions

- **Query received:** when the ticket is created, which is the student's first message. Every report puts a query on the IST date it was received.
- **TAT clock start:** the received time if it falls inside working hours. Otherwise the clock starts at the next 10:00 on a working day.
  - 18:00 exactly counts as after-hours.
  - A query at 08:00 on a working day starts at 10:00 that same day.
- **After-hours query:** any query received outside working hours, on a Sunday, or on a holiday. In the inbox it sits at the top with an "After-hours · priority" badge until someone sends the first reply.
- **Response:** the first agent message after the query arrives. It can be sent from the dashboard or straight from the WhatsApp phone, and it still counts if it was later deleted.
- **Resolution:** the time the ticket was marked Resolved. If an agent reopens it, it counts as unresolved again until it's resolved a second time; the later time is what counts.
- **Deadline:** clock start plus the TAT, counting only working time. For example, a query at Mon 16:00 is due for a response at Tue 11:00 (2h Monday + 1h Tuesday).
- **Within TAT:** done **at or before** the deadline. A reply at exactly the deadline is within TAT.
- **Breached:** done after the deadline (**late**), or not done and the deadline has passed (**overdue**).
  - A deadline that lands on 18:00 means 18:00 that day. A reply at 18:30 the same evening is breached, even though no extra *working* time passed.
- **Pending (not yet responded):** a query with no reply yet.
  - **Pending at close** (daily report): the number of queries still without a reply at 18:00 that day. It includes queries received on earlier days. For today it's counted as of right now. Sundays and holidays show "—".
  - For weekly and monthly reports, it's counted at 18:00 on the last working day of the period.
- **Working time shown on a ticket:** only the working hours between the query arriving and the reply or resolution (or now, if not done yet).

## Reports

**TAT Reports** tab, with Daily, Weekly (Monday–Sunday) and Monthly views and any date range.

The per-period columns are:
- Received
- Responded within TAT
- Response TAT breached
- Not yet responded
- Resolved within TAT
- Resolution TAT breached
- Not yet resolved
- Pending at close
- Received after-hours

Click any number to see the list of tickets behind it: received / due / done times, status, and working time taken. Click a ticket number to open the conversation. Both the summary and the ticket list download as CSV.

## Test cases

October 2026 calendar: Mon 12, Tue 13, Wed 14, Thu 15, Fri 16, Sat 17, Sun 18, Mon 19, Tue 20, Wed 21, Thu 22.

| # | Scenario | Received | Clock starts | Response due | Resolution due |
|---|---|---|---|---|---|
| R1 | opening minute | Mon 12 10:00 | Mon 10:00 | Mon 13:00 | Wed 14 18:00 |
| R2 | mid-morning | Mon 11:30 | Mon 11:30 | Mon 14:30 | Thu 15 11:30 |
| R3 | response runs into the next day | Mon 16:00 | Mon 16:00 | Tue 11:00 | Thu 16:00 |
| R4 | last working minute | Mon 17:59 | Mon 17:59 | Tue 12:59 | Thu 17:59 |
| R5 | deadline lands exactly on 18:00 | Mon 15:00 | Mon 15:00 | Mon 18:00 | Thu 15:00 |
| R6 | exactly 18:00 = after-hours | Mon 18:00 | Tue 10:00 | Tue 13:00 | Thu 18:00 |
| R7 | evening | Mon 21:00 | Tue 10:00 | Tue 13:00 | Thu 18:00 |
| R8 | early morning | Tue 08:00 | Tue 10:00 | Tue 13:00 | Thu 18:00 |
| R9 | midnight | Tue 00:00 | Tue 10:00 | Tue 13:00 | Thu 18:00 |
| R9b | 1 min before opening | Mon 09:59 | Mon 10:00 | Mon 13:00 | Wed 18:00 |
| R10 | Saturday is a working day | Sat 17 16:00 | Sat 16:00 | Mon 19 11:00 | Wed 21 16:00 |
| R11 | Saturday evening | Sat 18:30 | Mon 10:00 | Mon 13:00 | — |
| R12 | Sunday | Sun 18 12:00 | Mon 10:00 | Mon 13:00 | Wed 18:00 |
| H5 | resolution over a weekend | Fri 16 10:00 | Fri 10:00 | — | Mon 19 18:00 |
| H1 | Monday holiday | Sun 18 15:00 | Tue 20 10:00 | Tue 13:00 | Thu 22 18:00 |
| H2 | received during hours *on* a holiday | Mon 19 (hol.) 11:00 | Tue 10:00 | — | — |
| H3 | Saturday holiday | Fri 16 17:00 | Fri 17:00 | Mon 19 12:00 | Wed 21 17:00 |
| H4 | two holidays in a row (Mon+Tue) | Sat 17 17:00 | Sat 17:00 | Wed 21 12:00 | — |
| Z1–Z3 | judged in IST, not UTC (e.g. 12:45 UTC = 18:15 IST is after-hours) | | | | |

| # | Status rule (query Mon 10:00, response due 13:00, resolution due Wed 18:00) | Result |
|---|---|---|
| S1 | reply at 13:00 exactly | within TAT |
| S2 | reply at 13:01 | breached (late) |
| S3 | reply at 12:59 | within TAT |
| S4 | no reply, now 12:00 | pending, not breached |
| S5 | no reply, now 13:00 exactly | pending, not breached |
| S6 | no reply, now 13:01 | breached (overdue) |
| S7 | after-hours query (21:00) answered at 22:00, before the clock starts | within TAT, 0 working min |
| S8a/b | resolved Wed 18:00 / 18:01 | within TAT / breached |
| S9/S10 | unresolved, now Thu 10:00 / Wed 17:00 | breached / pending |
| W1–W5 | working time: Mon 17:00→Tue 11:00 = 2h; Mon 17:00→Tue 09:00 = 1h; Sat 17:00→Mon 10:30 = 1h30 | |

**End-to-end daily report.** The test uses seven queries (A–G), including two from the previous Friday, and checks every count:
- Pending at close: 2 on Monday, 2 on Tuesday, 3 for Wednesday as of 12:00.
- Range totals: 5 received, 2 responded within TAT, 2 response breaches.

**On beta:** `scripts/seed-beta-tat.js` loads 10 scenarios (S1–S10), including a seeded holiday, into the beta database. Each ticket's notes say what the dashboard should show for it.
