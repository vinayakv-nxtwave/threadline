import { Router } from "express";
import { pool } from "../db.js";
import { loadHolidays } from "../services/holidays.js";
import { loadPendingTimes } from "../services/status.js";
import {
  TAT_CONFIG,
  PERIODS,
  buildTatReport,
  bucketKeyForDate,
  localDateKey,
  localMidnightUtc,
} from "../services/tat.js";

const router = Router();

// GET /api/analytics/summary?days=14
router.get("/summary", async (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 14, 90);

  const [
    createdPerDay,
    resolvedPerDay,
    byStatus,
    byCategory,
    byPriority,
    avgResolution,
    avgTurnaround,
    byAgent,
  ] = await Promise.all([
    pool.query(
      `SELECT date_trunc('day', created_at) AS day, COUNT(*) AS created
       FROM tickets WHERE created_at > now() - ($1 || ' days')::interval
       GROUP BY 1 ORDER BY 1`,
      [days]
    ),
    pool.query(
      `SELECT date_trunc('day', resolved_at) AS day, COUNT(*) AS resolved
       FROM tickets
       WHERE resolved_at IS NOT NULL AND resolved_at > now() - ($1 || ' days')::interval
       GROUP BY 1 ORDER BY 1`,
      [days]
    ),
    pool.query(
      `SELECT status, COUNT(*) AS count FROM tickets
       WHERE created_at > now() - ($1 || ' days')::interval
       GROUP BY status`,
      [days]
    ),
    pool.query(
      `SELECT category, COUNT(*) AS count FROM tickets
       WHERE created_at > now() - ($1 || ' days')::interval
       GROUP BY category ORDER BY count DESC`,
      [days]
    ),
    pool.query(
      `SELECT priority, COUNT(*) AS count FROM tickets
       WHERE created_at > now() - ($1 || ' days')::interval
       GROUP BY priority`,
      [days]
    ),
    pool.query(
      `SELECT AVG(EXTRACT(EPOCH FROM (resolved_at - COALESCE(last_reopened_at, created_at)))) AS avg_seconds
       FROM tickets
       WHERE resolved_at IS NOT NULL AND created_at > now() - ($1 || ' days')::interval`,
      [days]
    ),
    pool.query(
      `WITH pairs AS (
         SELECT t.id AS ticket_id,
                COALESCE(t.last_reopened_at, t.created_at) AS opened_at,
                MIN(m.created_at) AS reply_at
         FROM tickets t
         JOIN messages m ON m.ticket_id = t.id
           AND m.direction = 'outbound'
           AND m.created_at > COALESCE(t.last_reopened_at, t.created_at)
         WHERE t.created_at > now() - ($1 || ' days')::interval
         GROUP BY t.id, t.last_reopened_at, t.created_at
       )
       SELECT AVG(EXTRACT(EPOCH FROM (reply_at - opened_at))) AS avg_seconds FROM pairs`,
      [days]
    ),
    pool.query(
      `SELECT COALESCE(assignee, 'Unassigned') AS agent,
              COUNT(*) AS handled,
              COUNT(*) FILTER (WHERE status IN ('resolved','closed')) AS resolved_count,
              AVG(EXTRACT(EPOCH FROM (resolved_at - COALESCE(last_reopened_at, created_at))))
                FILTER (WHERE resolved_at IS NOT NULL) AS avg_resolution_seconds
       FROM tickets
       WHERE created_at > now() - ($1 || ' days')::interval
       GROUP BY agent ORDER BY handled DESC`,
      [days]
    ),
  ]);

  const totalTickets = byStatus.rows.reduce((s, r) => s + Number(r.count), 0);
  const resolvedTotal = byStatus.rows
    .filter((r) => ["resolved", "closed"].includes(r.status))
    .reduce((s, r) => s + Number(r.count), 0);

  // Merge created-per-day and resolved-per-day into one series keyed by date,
  // since a ticket can be created on one day and resolved on another.
  const volumeByDate = new Map();
  for (const r of createdPerDay.rows) {
    const key = r.day.toISOString();
    volumeByDate.set(key, { date: r.day, created: Number(r.created), resolved: 0 });
  }
  for (const r of resolvedPerDay.rows) {
    const key = r.day.toISOString();
    const existing = volumeByDate.get(key);
    if (existing) {
      existing.resolved = Number(r.resolved);
    } else {
      volumeByDate.set(key, { date: r.day, created: 0, resolved: Number(r.resolved) });
    }
  }
  const volume = [...volumeByDate.values()].sort((a, b) => new Date(a.date) - new Date(b.date));

  res.json({
    rangeDays: days,
    totalTickets,
    resolutionRate: totalTickets ? Math.round((resolvedTotal / totalTickets) * 100) : null,
    avgResolutionSeconds: avgResolution.rows[0].avg_seconds
      ? Math.round(avgResolution.rows[0].avg_seconds)
      : null,
    avgTurnaroundSeconds: avgTurnaround.rows[0].avg_seconds
      ? Math.round(avgTurnaround.rows[0].avg_seconds)
      : null,
    volume,
    byStatus: byStatus.rows.map((r) => ({ status: r.status, count: Number(r.count) })),
    byCategory: byCategory.rows.map((r) => ({ category: r.category, count: Number(r.count) })),
    byPriority: byPriority.rows.map((r) => ({ priority: r.priority, count: Number(r.count) })),
    byAgent: byAgent.rows.map((r) => ({
      agent: r.agent,
      handled: Number(r.handled),
      resolutionRate: r.handled > 0 ? Math.round((r.resolved_count / r.handled) * 100) : null,
      avgResolutionSeconds: r.avg_resolution_seconds ? Math.round(r.avg_resolution_seconds) : null,
    })),
  });
});

// Default look-back per period when no from/to is given.
const DEFAULT_SPAN = { day: 14, week: 8 * 7, month: 183 };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/analytics/tat?period=day|week|month&from=YYYY-MM-DD&to=YYYY-MM-DD
// Dates are IST calendar dates, inclusive. Rules: docs/TAT.md.
router.get("/tat", async (req, res) => {
  const period = PERIODS.includes(req.query.period) ? req.query.period : "day";
  const now = new Date();
  const todayKey = localDateKey(now);
  const toKey = DATE_RE.test(req.query.to || "") ? req.query.to : todayKey;
  let fromKey = DATE_RE.test(req.query.from || "") ? req.query.from : null;
  if (!fromKey) {
    const span = DEFAULT_SPAN[period];
    fromKey = new Date(Date.parse(`${toKey}T00:00:00Z`) - (span - 1) * 86400000).toISOString().slice(0, 10);
    if (period === "week") fromKey = bucketKeyForDate(fromKey, "week");
    if (period === "month") fromKey = `${fromKey.slice(0, 7)}-01`;
  }
  if (fromKey > toKey) return res.status(400).json({ error: "from must be on or before to" });
  if (Date.parse(toKey) - Date.parse(fromKey) > 400 * 86400000) {
    return res.status(400).json({ error: "range too large (max ~13 months)" });
  }

  const holidays = await loadHolidays();
  if (holidays.missingTable) {
    return res.status(500).json({ error: "holidays table missing -- run src/schema.sql on this database" });
  }

  const fromUtc = localMidnightUtc(fromKey);
  const toUtcExclusive = new Date(localMidnightUtc(toKey).getTime() + 86400000);

  // Everything received in the range, plus older queries that were still
  // unanswered when the range began (they count toward the daily backlog).
  // "Response" = the first agent message at/after the query arrived, whether
  // sent from the CRM or straight from the WhatsApp phone, deleted or not.
  const { rows } = await pool.query(
    `SELECT * FROM (
       SELECT t.id, t.ticket_no, t.student_name, t.student_phone, t.status, t.category,
              t.priority, t.assignee, t.created_at, t.updated_at,
              CASE WHEN t.status IN ('resolved','closed') THEN COALESCE(t.resolved_at, t.updated_at) END AS resolved_at,
              (SELECT MIN(m.created_at) FROM messages m
                WHERE m.ticket_id = t.id AND m.direction = 'outbound' AND m.created_at >= t.created_at
              ) AS first_response_at
       FROM tickets t
       WHERE t.created_at < $2
     ) q
     WHERE q.created_at >= $1 OR q.first_response_at IS NULL OR q.first_response_at >= $1
     ORDER BY q.created_at`,
    [fromUtc, toUtcExclusive]
  );

  const pending = await loadPendingTimes(rows.map((r) => r.id), holidays.dates, now);
  const report = buildTatReport(
    {
      tickets: rows.map((r) => ({
        pendingTime: pending.get(r.id),
        id: r.id,
        ticketNo: r.ticket_no,
        studentName: r.student_name,
        studentPhone: r.student_phone,
        status: r.status,
        category: r.category,
        priority: r.priority,
        assignee: r.assignee,
        receivedAt: r.created_at,
        firstResponseAt: r.first_response_at,
        resolvedAt: r.resolved_at,
      })),
      period,
      fromKey,
      toKey,
      now,
    },
    { holidays: holidays.dates }
  );

  res.json({
    config: { ...TAT_CONFIG, holidays: holidays.rows },
    ...report,
  });
});

export default router;
