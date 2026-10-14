// Ticket status rules -- pure, no database, covered by tests/status.test.js.
// The human-readable version is docs/STATUSES.md.

import { workingMinutesBetween } from "./tat.js";

export const STATUSES = ["new", "open", "pending", "resolved"];

// What each event does to the status. `from` = the statuses it applies to;
// any other current status is left as it is.
export const TRANSITIONS = {
  // Agent clicks into the chat in the CRM
  agent_opened: { from: ["new"], to: "open" },
  // Agent sends a message (CRM reply, forward, or straight from the WhatsApp phone)
  agent_reply: { from: ["new", "open"], to: "pending" },
};
// Student messages never change an existing ticket's status: New stays New,
// Open stays Open, Pending stays Pending (still waiting on the dependency).
// A message after Resolved starts a NEW ticket instead (ticketService.js).

/**
 * Time a ticket has spent in Pending, from its status history.
 * @param events  [{ to_status, created_at }] oldest first
 * @param now     counts an ongoing Pending stint up to this instant
 * @returns {{ currentSince: Date|null, currentWorkingMinutes: number,
 *             totalWorkingMinutes: number, totalMinutes: number, stints: number }}
 *   working minutes use TAT working hours (10:00-18:00 Mon-Sat, excl. holidays);
 *   totalMinutes is plain clock time.
 */
export function pendingTime(events, now = new Date(), options) {
  let since = null;
  let totalWorking = 0;
  let totalClock = 0;
  let stints = 0;
  let currentWorking = 0;
  const end = new Date(now);

  const close = (until) => {
    totalWorking += workingMinutesBetween(since, until, options);
    totalClock += Math.max(0, Math.round((until - since) / 60000));
  };

  for (const e of events) {
    const at = new Date(e.created_at);
    if (e.to_status === "pending") {
      if (!since) {
        since = at;
        stints++;
      }
    } else if (since) {
      close(at);
      since = null;
    }
  }
  if (since) {
    currentWorking = workingMinutesBetween(since, end, options);
    close(end);
  }
  return {
    currentSince: since,
    currentWorkingMinutes: currentWorking,
    totalWorkingMinutes: totalWorking,
    totalMinutes: totalClock,
    stints,
  };
}
