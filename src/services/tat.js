// TAT (turnaround time) engine -- pure functions, no database access, so every
// rule here is covered by tests/tat.test.js. Definitions are in docs/TAT.md.
//
// All calendar logic runs on India wall-clock time. IST is a fixed UTC+05:30
// with no daylight saving, so a constant offset is exact.

export const TAT_CONFIG = Object.freeze({
  utcOffsetMinutes: 330, // IST
  workStartMinute: 10 * 60, // 10:00
  workEndMinute: 18 * 60, // 18:00 (exclusive: a query at exactly 18:00 is after-hours)
  workDays: Object.freeze([1, 2, 3, 4, 5, 6]), // Mon-Sat; Sunday (0) is off
  responseTatMinutes: 3 * 60, // 3 working hours
  resolutionTatMinutes: 24 * 60, // 24 working hours = 3 full working days
});

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
// Guards the day-by-day scans against a calendar with no working days at all
// (e.g. every day marked a holiday) -- fail loudly instead of looping forever.
const MAX_SCAN_DAYS = 400;

function opts(options = {}) {
  const config = options.config || TAT_CONFIG;
  const holidays = options.holidays instanceof Set ? options.holidays : new Set(options.holidays || []);
  return { config, holidays };
}

const ms = (d) => (d instanceof Date ? d.getTime() : new Date(d).getTime());
const toLocal = (utcMs, config) => utcMs + config.utcOffsetMinutes * MIN;
const toUtc = (localMs, config) => localMs - config.utcOffsetMinutes * MIN;
const dayStartOf = (localMs) => Math.floor(localMs / DAY) * DAY;
const keyOfLocal = (localMs) => new Date(localMs).toISOString().slice(0, 10);

/** "YYYY-MM-DD" of the IST calendar date an instant falls on. */
export function localDateKey(date, options) {
  const { config } = opts(options);
  return keyOfLocal(toLocal(ms(date), config));
}

/** UTC instant of 00:00 IST on a "YYYY-MM-DD" date. */
export function localMidnightUtc(dateKey, options) {
  const { config } = opts(options);
  return new Date(toUtc(Date.parse(`${dateKey}T00:00:00Z`), config));
}

function workingWindow(dayStartLocal, { config, holidays }) {
  const d = new Date(dayStartLocal);
  if (!config.workDays.includes(d.getUTCDay())) return null;
  if (holidays.has(keyOfLocal(dayStartLocal))) return null;
  return [dayStartLocal + config.workStartMinute * MIN, dayStartLocal + config.workEndMinute * MIN];
}

/** True if the IST date is a working day (right weekday, not a holiday). */
export function isWorkingDay(dateKey, options) {
  const o = opts(options);
  return workingWindow(Date.parse(`${dateKey}T00:00:00Z`), o) !== null;
}

/**
 * When the TAT clock starts for something received at `receivedAt`: the
 * instant itself if inside working hours, otherwise the start of the next
 * working window (10:00 on the next working day, or today if before 10:00).
 */
export function clockStart(receivedAt, options) {
  const o = opts(options);
  let local = toLocal(ms(receivedAt), o.config);
  let day = dayStartOf(local);
  for (let i = 0; i < MAX_SCAN_DAYS; i++) {
    const w = workingWindow(day, o);
    if (w) {
      if (local < w[0]) return new Date(toUtc(w[0], o.config));
      if (local < w[1]) return new Date(toUtc(local, o.config));
    }
    day += DAY;
    local = day;
  }
  throw new Error("No working day found within scan limit -- check working days / holidays config");
}

/** The instant reached after `minutes` of working time from `from`. */
export function addWorkingMinutes(from, minutes, options) {
  const o = opts(options);
  let cur = toLocal(clockStart(from, o).getTime(), o.config);
  let remaining = minutes * MIN;
  for (let i = 0; i < MAX_SCAN_DAYS; i++) {
    const w = workingWindow(dayStartOf(cur), o); // cur is always inside a window here
    const available = w[1] - cur;
    // <= so a deadline that lands exactly on 18:00 stays on that day (18:00),
    // rather than rolling to 10:00 the next working day.
    if (remaining <= available) return new Date(toUtc(cur + remaining, o.config));
    remaining -= available;
    cur = toLocal(clockStart(toUtc(w[1], o.config), o).getTime(), o.config);
  }
  throw new Error("No working day found within scan limit -- check working days / holidays config");
}

/** Working minutes elapsed between two instants (0 if b <= a). */
export function workingMinutesBetween(a, b, options) {
  const o = opts(options);
  const start = toLocal(ms(a), o.config);
  const end = toLocal(ms(b), o.config);
  if (end <= start) return 0;
  let total = 0;
  for (let day = dayStartOf(start); day < end; day += DAY) {
    const w = workingWindow(day, o);
    if (!w) continue;
    const s = Math.max(w[0], start);
    const e = Math.min(w[1], end);
    if (e > s) total += e - s;
  }
  return Math.round(total / MIN);
}

// met: done by the deadline · late: done after it
// pending: not done, deadline not yet passed · overdue: not done, deadline passed
function clockStatus(doneAt, dueAt, now) {
  if (doneAt) return doneAt.getTime() <= dueAt.getTime() ? "met" : "late";
  return now.getTime() > dueAt.getTime() ? "overdue" : "pending";
}
export const isBreached = (status) => status === "late" || status === "overdue";

/**
 * Full TAT picture for one query.
 * @param {{receivedAt, firstResponseAt?, resolvedAt?}} q
 */
export function evaluateTicket(q, now = new Date(), options) {
  const o = opts(options);
  const receivedAt = new Date(q.receivedAt);
  const firstResponseAt = q.firstResponseAt ? new Date(q.firstResponseAt) : null;
  const resolvedAt = q.resolvedAt ? new Date(q.resolvedAt) : null;
  const nowD = new Date(now);

  const start = clockStart(receivedAt, o);
  const responseDueAt = addWorkingMinutes(start, o.config.responseTatMinutes, o);
  const resolutionDueAt = addWorkingMinutes(start, o.config.resolutionTatMinutes, o);
  const responseStatus = clockStatus(firstResponseAt, responseDueAt, nowD);
  const resolutionStatus = clockStatus(resolvedAt, resolutionDueAt, nowD);

  return {
    receivedAt,
    clockStartAt: start,
    afterHours: start.getTime() !== receivedAt.getTime(),
    firstResponseAt,
    responseDueAt,
    responseStatus,
    responseBreached: isBreached(responseStatus),
    responseWorkingMinutes: workingMinutesBetween(receivedAt, firstResponseAt || nowD, o),
    resolvedAt,
    resolutionDueAt,
    resolutionStatus,
    resolutionBreached: isBreached(resolutionStatus),
    resolutionWorkingMinutes: workingMinutesBetween(receivedAt, resolvedAt || nowD, o),
  };
}

// ---------------------------------------------------------------- reports

export const PERIODS = ["day", "week", "month"];

/** Bucket key an IST date belongs to: the date, its week's Monday, or "YYYY-MM". */
export function bucketKeyForDate(dateKey, period) {
  if (period === "day") return dateKey;
  if (period === "month") return dateKey.slice(0, 7);
  const d = Date.parse(`${dateKey}T00:00:00Z`);
  const sinceMonday = (new Date(d).getUTCDay() + 6) % 7;
  return keyOfLocal(d - sinceMonday * DAY);
}

function addMonths(monthKey, n) {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

/** Every bucket from `fromKey` to `toKey` (IST dates, inclusive), with its IST date span. */
export function bucketsInRange(fromKey, toKey, period) {
  const out = [];
  let key = bucketKeyForDate(fromKey, period);
  const lastKey = bucketKeyForDate(toKey, period);
  for (let i = 0; i < 1000; i++) {
    let startKey, endKey, nextKey;
    if (period === "month") {
      startKey = `${key}-01`;
      nextKey = addMonths(key, 1);
      endKey = keyOfLocal(Date.parse(`${nextKey}-01T00:00:00Z`) - DAY);
    } else {
      const len = period === "week" ? 7 : 1;
      startKey = key;
      endKey = keyOfLocal(Date.parse(`${key}T00:00:00Z`) + (len - 1) * DAY);
      nextKey = keyOfLocal(Date.parse(`${key}T00:00:00Z`) + len * DAY);
    }
    out.push({ key, startKey, endKey });
    if (key === lastKey) return out;
    key = nextKey;
  }
  throw new Error("Range too large");
}

/**
 * Builds the TAT report.
 * @param tickets  [{ id, receivedAt, firstResponseAt, resolvedAt, ... }] -- every
 *                 query received in the range, plus any received earlier that
 *                 were still unanswered at the start of it (for the backlog).
 * @param period   "day" | "week" | "month"
 * @param fromKey/toKey  IST "YYYY-MM-DD", inclusive
 */
export function buildTatReport({ tickets, period, fromKey, toKey, now = new Date() }, options) {
  const o = opts(options);
  const nowD = new Date(now);
  const evaluated = tickets.map((t) => ({ ...t, tat: evaluateTicket(t, nowD, o) }));

  const buckets = bucketsInRange(fromKey, toKey, period).map((b) => {
    const ids = {
      received: [],
      respondedWithinTat: [],
      respondedLate: [],
      awaitingResponse: [],
      responseBreached: [],
      resolvedWithinTat: [],
      resolvedLate: [],
      unresolved: [],
      resolutionBreached: [],
      afterHours: [],
      backlogAtClose: [],
    };

    for (const t of evaluated) {
      const key = localDateKey(t.tat.receivedAt, o);
      if (key < b.startKey || key > b.endKey) continue;
      const { tat } = t;
      ids.received.push(t.id);
      if (tat.afterHours) ids.afterHours.push(t.id);
      if (tat.responseStatus === "met") ids.respondedWithinTat.push(t.id);
      if (tat.responseStatus === "late") ids.respondedLate.push(t.id);
      if (!tat.firstResponseAt) ids.awaitingResponse.push(t.id);
      if (tat.responseBreached) ids.responseBreached.push(t.id);
      if (tat.resolutionStatus === "met") ids.resolvedWithinTat.push(t.id);
      if (tat.resolutionStatus === "late") ids.resolvedLate.push(t.id);
      if (!tat.resolvedAt) ids.unresolved.push(t.id);
      if (tat.resolutionBreached) ids.resolutionBreached.push(t.id);
    }

    // Backlog ("pending"): queries still without a first reply at close of
    // business (18:00 IST) on the last working day of the bucket -- or right
    // now, if that close hasn't happened yet. Includes queries received on
    // earlier days. Null for a bucket with no working day in it.
    let closeKey = null;
    for (let d = Date.parse(`${b.endKey}T00:00:00Z`); d >= Date.parse(`${b.startKey}T00:00:00Z`); d -= DAY) {
      if (workingWindow(d, o)) {
        closeKey = keyOfLocal(d);
        break;
      }
    }
    let backlogAsOf = null;
    if (closeKey) {
      const closeAt = toUtc(Date.parse(`${closeKey}T00:00:00Z`) + o.config.workEndMinute * MIN, o.config);
      const startOfBucket = localMidnightUtc(b.startKey, o).getTime();
      if (startOfBucket <= nowD.getTime()) {
        const asOf = Math.min(closeAt, nowD.getTime());
        backlogAsOf = new Date(asOf);
        for (const t of evaluated) {
          if (t.tat.receivedAt.getTime() > asOf) continue;
          if (t.tat.firstResponseAt && t.tat.firstResponseAt.getTime() <= asOf) continue;
          ids.backlogAtClose.push(t.id);
        }
      }
    }

    const counts = Object.fromEntries(Object.entries(ids).map(([k, v]) => [k, v.length]));
    return { ...b, backlogAsOf, counts, ids };
  });

  const inRange = evaluated.filter((t) => {
    const key = localDateKey(t.tat.receivedAt, o);
    return key >= fromKey && key <= toKey;
  });
  const totals = {
    received: inRange.length,
    respondedWithinTat: inRange.filter((t) => t.tat.responseStatus === "met").length,
    responseBreached: inRange.filter((t) => t.tat.responseBreached).length,
    awaitingResponse: inRange.filter((t) => !t.tat.firstResponseAt).length,
    resolvedWithinTat: inRange.filter((t) => t.tat.resolutionStatus === "met").length,
    resolutionBreached: inRange.filter((t) => t.tat.resolutionBreached).length,
    unresolved: inRange.filter((t) => !t.tat.resolvedAt).length,
  };

  return { period, fromKey, toKey, now: nowD, buckets, totals, tickets: evaluated };
}
