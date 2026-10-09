import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import webhookRouter from "./routes/webhook.js";
import ticketsRouter from "./routes/tickets.js";
import authRouter from "./routes/auth.js";
import analyticsRouter from "./routes/analytics.js";
import devRouter from "./routes/dev.js";
import { requireAuth } from "./middleware/auth.js";
import { APP_ENV, IS_BETA } from "./env.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.use("/webhook", webhookRouter);
app.use("/api/auth", authRouter);
app.use("/api/tickets", requireAuth, ticketsRouter);
app.use("/api/analytics", requireAuth, analyticsRouter);
if (IS_BETA) app.use("/api/dev", requireAuth, devRouter);

app.get("/health", (req, res) => res.json({ ok: true, env: APP_ENV }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Threadline backend (${APP_ENV}) listening on port ${PORT}`);
  if (IS_BETA) console.log("[beta] WhatsApp sending is disabled; outbound messages are logged only.");
});
