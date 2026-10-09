import { Router } from "express";
import { pool } from "../db.js";
import { loadHolidays, clearHolidayCache } from "../services/holidays.js";

const router = Router();
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/holidays
router.get("/", async (req, res) => {
  const { rows, missingTable } = await loadHolidays();
  if (missingTable) return res.status(500).json({ error: "holidays table missing -- run src/schema.sql" });
  res.json(rows);
});

// POST /api/holidays  { date: "YYYY-MM-DD", name }  (re-posting a date renames it)
router.post("/", async (req, res) => {
  const { date, name } = req.body || {};
  if (!DATE_RE.test(date || "") || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    return res.status(400).json({ error: "date must be YYYY-MM-DD" });
  }
  if (!name || !name.trim()) return res.status(400).json({ error: "name is required" });
  await pool.query(
    `INSERT INTO holidays (holiday_date, name) VALUES ($1, $2)
     ON CONFLICT (holiday_date) DO UPDATE SET name = EXCLUDED.name`,
    [date, name.trim()]
  );
  clearHolidayCache();
  res.json({ ok: true });
});

// DELETE /api/holidays/:date
router.delete("/:date", async (req, res) => {
  if (!DATE_RE.test(req.params.date)) return res.status(400).json({ error: "date must be YYYY-MM-DD" });
  await pool.query(`DELETE FROM holidays WHERE holiday_date = $1`, [req.params.date]);
  clearHolidayCache();
  res.json({ ok: true });
});

export default router;
