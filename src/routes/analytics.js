import { Router } from "express";
import { pool } from "../db.js";

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
    avgResponse,
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
      `SELECT AVG(EXTRACT(EPOCH FROM (resolved_at - created_at))) AS avg_seconds
       FROM tickets
       WHERE resolved_at IS NOT NULL AND created_at > now() - ($1 || ' days')::interval`,
      [days]
    ),
    pool.query(
      `WITH pairs AS (
         SELECT m1.ticket_id, m1.created_at AS inbound_at, MIN(m2.created_at) AS reply_at
         FROM messages m1
         JOIN messages m2 ON m2.ticket_id = m1.ticket_id
           AND m2.direction = 'outbound' AND m2.created_at > m1.created_at
         JOIN tickets t ON t.id = m1.ticket_id
         WHERE m1.direction = 'inbound' AND t.created_at > now() - ($1 || ' days')::interval
         GROUP BY m1.ticket_id, m1.created_at
       )
       SELECT AVG(EXTRACT(EPOCH FROM (reply_at - inbound_at))) AS avg_seconds FROM pairs`,
      [days]
    ),
    pool.query(
      `SELECT COALESCE(assignee, 'Unassigned') AS agent,
              COUNT(*) AS handled,
              COUNT(*) FILTER (WHERE status IN ('resolved','closed')) AS resolved_count,
              AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)))
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
    avgResponseSeconds: avgResponse.rows[0].avg_seconds
      ? Math.round(avgResponse.rows[0].avg_seconds)
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

export default router;
