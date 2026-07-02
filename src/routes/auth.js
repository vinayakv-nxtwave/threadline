import { Router } from "express";
import crypto from "crypto";
import { issueToken } from "../middleware/auth.js";

const router = Router();

// POST /api/auth/login  { password } -> { token }
router.post("/login", (req, res) => {
  const expected = process.env.DASHBOARD_PASSWORD;
  if (!expected) {
    return res.status(500).json({ error: "DASHBOARD_PASSWORD is not configured on the server" });
  }

  const provided = Buffer.from(String(req.body?.password || ""));
  const expectedBuf = Buffer.from(expected);
  const valid =
    provided.length === expectedBuf.length && crypto.timingSafeEqual(provided, expectedBuf);

  if (!valid) return res.status(401).json({ error: "incorrect password" });

  res.json({ token: issueToken() });
});

export default router;
