import { pool } from "../db.js";
import { normalizeWhapiMessage } from "./whapiMessage.js";
import { handleIncomingMessage, logAgentMessageFromPhone, findMessageByWhapiId, applyIncomingReaction } from "./ticketService.js";

// One message at a time. The webhook and the catch-up sync can both deliver
// the same message at nearly the same moment; serialising them means the
// duplicate check below always sees the other one's insert, and two quick
// messages from a new student can't race into two separate tickets.
let queue = Promise.resolve();
function serial(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

/**
 * Stores one raw Whapi message (from the webhook or the catch-up sync).
 * Safe to call any number of times for the same message.
 * @returns "imported" | "duplicate" | "reaction" | "edit" | "no-ticket" | "skip:<reason>"
 */
export function processWhapiMessage(raw) {
  return serial(async () => {
    const m = normalizeWhapiMessage(raw);

    if (m.kind === "skip") return `skip:${m.reason}`;
    if (m.kind === "reaction") {
      await applyIncomingReaction(m.target, m.emoji);
      return "reaction";
    }
    if (m.kind === "edit") {
      if (m.body != null) {
        await pool.query(`UPDATE messages SET body = $1, edited_at = now() WHERE whapi_message_id = $2`, [m.body, m.target]);
      }
      return "edit";
    }

    const { rows } = await pool.query(`SELECT 1 FROM messages WHERE whapi_message_id = $1 LIMIT 1`, [m.whapiMessageId]);
    if (rows.length) return "duplicate";

    const fields = {
      phone: m.phone,
      type: m.type,
      text: m.text,
      mediaUrl: m.mediaUrl,
      mimeType: m.mimeType,
      filename: m.filename,
      caption: m.caption,
      whapiMessageId: m.whapiMessageId,
    };
    if (m.fromMe) {
      const ticket = await logAgentMessageFromPhone({ ...fields, sentAt: m.receivedAt });
      return ticket ? "imported" : "no-ticket";
    }
    const quoted = m.quotedWhapiId ? await findMessageByWhapiId(m.quotedWhapiId) : null;
    await handleIncomingMessage({ ...fields, name: m.name, quotedMessageId: quoted?.id || null, receivedAt: m.receivedAt });
    return "imported";
  });
}
