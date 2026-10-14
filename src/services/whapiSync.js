// Catch-up sync: the safety net that guarantees no student message is lost.
//
// Whapi delivers messages to our webhook once, with no retry. If the server
// is asleep (Render free plan), restarting, or errors, that message is gone
// from the webhook's point of view. So the server also asks Whapi for its
// recent message list -- at startup and every couple of minutes -- and
// imports anything it doesn't have yet, with its original timestamp.
//
// Production only: beta has no WhatsApp channel (and must never read prod's).

import { IS_BETA } from "../env.js";
import { listMessages } from "./whapiClient.js";
import { processWhapiMessage } from "./whapiIngest.js";

const INTERVAL_MS = 2 * 60 * 1000;
const STARTUP_LOOKBACK_S = 3 * 24 * 60 * 60; // covers a weekend of downtime
const OVERLAP_S = 10 * 60; // re-check the last 10 min each run; duplicates are skipped

export const syncState = {
  enabled: false,
  running: false,
  lastRunAt: null,
  lastSuccessAt: null,
  lastError: null,
  lastRun: null, // { scanned, imported, ... }
  recoveredTotal: 0, // messages the webhook had missed, since this server started
};

/**
 * Imports every message on the channel since `sinceSeconds` (unix) that
 * isn't stored yet. Returns counts by outcome.
 */
export async function syncSince(sinceSeconds) {
  const messages = await listMessages(sinceSeconds);
  messages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)); // oldest first, like live delivery
  const counts = { scanned: messages.length };
  for (const msg of messages) {
    let outcome;
    try {
      outcome = await processWhapiMessage(msg);
    } catch (err) {
      outcome = "error";
      console.error(`[sync] failed to import ${msg.id}:`, err.message);
    }
    const key = outcome.startsWith("skip:") ? "skipped" : outcome;
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

async function runOnce(sinceSeconds) {
  if (syncState.running) return;
  syncState.running = true;
  const startedAt = new Date();
  syncState.lastRunAt = startedAt;
  try {
    const counts = await syncSince(sinceSeconds);
    syncState.lastRun = counts;
    syncState.lastSuccessAt = startedAt;
    syncState.lastError = null;
    syncState.recoveredTotal += counts.imported || 0;
    if (counts.imported) console.log(`[sync] recovered ${counts.imported} message(s) the webhook had missed`, counts);
    if (counts.error) console.error(`[sync] ${counts.error} message(s) failed to import; will retry next run`);
  } catch (err) {
    syncState.lastError = err.message;
    console.error("[sync] run failed:", err.message);
  } finally {
    syncState.running = false;
  }
}

export function startWhapiSync() {
  if (IS_BETA || !process.env.WHAPI_TOKEN) {
    console.log("[sync] catch-up sync disabled (beta or no WHAPI_TOKEN)");
    return;
  }
  syncState.enabled = true;
  const now = () => Math.floor(Date.now() / 1000);
  runOnce(now() - STARTUP_LOOKBACK_S);
  setInterval(() => {
    // From the last successful run (minus overlap), so a failed run is retried.
    const from = syncState.lastSuccessAt
      ? Math.floor(syncState.lastSuccessAt.getTime() / 1000) - OVERLAP_S
      : now() - STARTUP_LOOKBACK_S;
    runOnce(from);
  }, INTERVAL_MS);
}
