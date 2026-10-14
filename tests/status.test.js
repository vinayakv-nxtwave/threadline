// Status rules + time-in-Pending tests. Run: npm test
// Expected values worked out by hand from docs/STATUSES.md (working hours
// 10:00-18:00 IST Mon-Sat). Calendar: Mon 12 Oct 2026 ... Sun 18 Oct.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { STATUSES, TRANSITIONS, pendingTime } from "../src/services/statusRules.js";

const ist = (s) => new Date(`${s.replace(" ", "T")}:00+05:30`);
const ev = (to_status, at) => ({ to_status, created_at: ist(at) });

describe("statuses and automatic transitions", () => {
  test("exactly four statuses; Closed is gone", () => {
    assert.deepEqual(STATUSES, ["new", "open", "pending", "resolved"]);
  });
  test("agent opening the chat: New Ticket -> Open only", () => {
    assert.deepEqual(TRANSITIONS.agent_opened, { from: ["new"], to: "open" });
  });
  test("agent reply: New Ticket or Open -> Pending (Pending/Resolved untouched)", () => {
    assert.deepEqual(TRANSITIONS.agent_reply, { from: ["new", "open"], to: "pending" });
  });
  test("there is no automatic transition for student messages", () => {
    assert.deepEqual(Object.keys(TRANSITIONS).sort(), ["agent_opened", "agent_reply"]);
  });
});

describe("time in Pending (working hours)", () => {
  test("P1 never pending -> all zero", () => {
    const p = pendingTime([ev("new", "2026-10-12 10:00"), ev("open", "2026-10-12 10:05")], ist("2026-10-12 15:00"));
    assert.deepEqual(p, { currentSince: null, currentWorkingMinutes: 0, totalWorkingMinutes: 0, totalMinutes: 0, stints: 0 });
  });

  test("P2 still pending since Mon 11:00, now Mon 15:00 -> 4h", () => {
    const p = pendingTime([ev("new", "2026-10-12 10:00"), ev("pending", "2026-10-12 11:00")], ist("2026-10-12 15:00"));
    assert.equal(p.currentSince.toISOString(), ist("2026-10-12 11:00").toISOString());
    assert.equal(p.currentWorkingMinutes, 240);
    assert.equal(p.totalWorkingMinutes, 240);
    assert.equal(p.totalMinutes, 240);
    assert.equal(p.stints, 1);
  });

  test("P3 pending Mon 17:00 -> resolved Tue 11:00 = 2h working, 18h clock", () => {
    const p = pendingTime(
      [ev("new", "2026-10-12 16:00"), ev("pending", "2026-10-12 17:00"), ev("resolved", "2026-10-13 11:00")],
      ist("2026-10-14 12:00")
    );
    assert.equal(p.currentSince, null);
    assert.equal(p.currentWorkingMinutes, 0);
    assert.equal(p.totalWorkingMinutes, 120);
    assert.equal(p.totalMinutes, 18 * 60);
  });

  test("P4 two Pending stints add up (2h + 30m)", () => {
    const p = pendingTime(
      [
        ev("new", "2026-10-12 09:00"),
        ev("pending", "2026-10-12 10:00"),
        ev("open", "2026-10-12 12:00"), // agent set it back to Open
        ev("pending", "2026-10-13 10:00"),
        ev("resolved", "2026-10-13 10:30"),
      ],
      ist("2026-10-14 12:00")
    );
    assert.equal(p.totalWorkingMinutes, 150);
    assert.equal(p.stints, 2);
  });

  test("P5 Sunday doesn't count: pending Sat 17:00, now Mon 11:00 = 2h", () => {
    const p = pendingTime([ev("pending", "2026-10-17 17:00")], ist("2026-10-19 11:00"));
    assert.equal(p.currentWorkingMinutes, 120);
  });

  test("P6 holiday doesn't count: pending Fri 17:00, Sat holiday, now Mon 11:00 = 2h", () => {
    const p = pendingTime([ev("pending", "2026-10-16 17:00")], ist("2026-10-19 11:00"), { holidays: ["2026-10-17"] });
    assert.equal(p.currentWorkingMinutes, 120);
  });

  test("P7 a repeated 'pending' event doesn't restart the timer", () => {
    const p = pendingTime(
      [ev("pending", "2026-10-12 10:00"), ev("pending", "2026-10-12 12:00")],
      ist("2026-10-12 13:00")
    );
    assert.equal(p.currentSince.toISOString(), ist("2026-10-12 10:00").toISOString());
    assert.equal(p.currentWorkingMinutes, 180);
    assert.equal(p.stints, 1);
  });
});
