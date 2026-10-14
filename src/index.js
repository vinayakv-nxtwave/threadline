import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import webhookRouter from "./routes/webhook.js";
import ticketsRouter from "./routes/tickets.js";
import authRouter from "./routes/auth.js";
import analyticsRouter from "./routes/analytics.js";
import devRouter from "./routes/dev.js";
import holidaysRouter from "./routes/holidays.js";
import { requireAuth } from "./middleware/auth.js";
import { APP_ENV, IS_BETA } from "./env.js";
import { startWhapiSync, syncState } from "./services/whapiSync.js";

dotenv.config();

const app = express();
app.use(cors());
// Whapi batches can carry base64 link-preview thumbnails; the 100kb default
// would reject (and lose) them.
app.use(express.json({ limit: "10mb" }));

app.use("/webhook", webhookRouter);
app.use("/api/auth", authRouter);
app.use("/api/tickets", requireAuth, ticketsRouter);
app.use("/api/analytics", requireAuth, analyticsRouter);
app.use("/api/holidays", requireAuth, holidaysRouter);
if (IS_BETA) app.use("/api/dev", requireAuth, devRouter);

// Catch-up sync health: when it last ran and how many missed messages it recovered
app.get("/api/sync/status", requireAuth, (req, res) => res.json(syncState));

app.get("/health", (req, res) => res.json({ ok: true, env: APP_ENV }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Threadline backend (${APP_ENV}) listening on port ${PORT}`);
  if (IS_BETA) console.log("[beta] WhatsApp sending is disabled; outbound messages are logged only.");
  startWhapiSync();
});
