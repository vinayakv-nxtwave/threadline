import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import webhookRouter from "./routes/webhook.js";
import ticketsRouter from "./routes/tickets.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.use("/webhook", webhookRouter);
app.use("/api/tickets", ticketsRouter);

app.get("/health", (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Threadline backend listening on port ${PORT}`);
});
