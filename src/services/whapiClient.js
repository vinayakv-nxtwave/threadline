import dotenv from "dotenv";
dotenv.config();

const WHAPI_BASE = "https://gate.whapi.cloud";
const TOKEN = process.env.WHAPI_TOKEN;

/**
 * Sends a plain text WhatsApp message via Whapi.Cloud.
 * @param {string} phone - Recipient number in international format, digits only (no "+").
 * @param {string} body - Message text.
 * @param {string|null} quotedWhapiMessageId - whapi_message_id of a message to quote/reply to.
 */
export async function sendText(phone, body, quotedWhapiMessageId = null) {
  if (!TOKEN) {
    throw new Error("WHAPI_TOKEN is not set. Add it to your .env file.");
  }

  const payload = { to: phone, body };
  if (quotedWhapiMessageId) payload.quoted = quotedWhapiMessageId;

  const res = await fetch(`${WHAPI_BASE}/messages/text`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(`Whapi send failed (${res.status}): ${JSON.stringify(data)}`);
  }

  return data;
}

/**
 * Sends a media WhatsApp message (image/video/gif/audio/voice/document/sticker) via Whapi.Cloud.
 * @param {string} phone - Recipient number in international format, digits only (no "+").
 * @param {string} type - image | video | gif | audio | voice | document | sticker
 * @param {string} media - Public URL, or a base64 data URI (data:<mime>;name=<file>;base64,<...>)
 */
export async function sendMedia(phone, type, media, { caption, filename } = {}) {
  if (!TOKEN) {
    throw new Error("WHAPI_TOKEN is not set. Add it to your .env file.");
  }

  const res = await fetch(`${WHAPI_BASE}/messages/${type}`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({ to: phone, media, caption, filename }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(`Whapi media send failed (${res.status}): ${JSON.stringify(data)}`);
  }

  return data;
}

/**
 * Sets (or, with an empty emoji, clears) a reaction on a message via Whapi.Cloud.
 * @param {string} whapiMessageId - The whapi message id to react to.
 * @param {string} emoji - Reaction emoji; empty string/null clears the reaction.
 */
export async function sendReaction(whapiMessageId, emoji) {
  if (!TOKEN) {
    throw new Error("WHAPI_TOKEN is not set. Add it to your .env file.");
  }

  const res = await fetch(`${WHAPI_BASE}/messages/${whapiMessageId}/reaction`, {
    method: "PUT",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({ emoji: emoji || "" }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(`Whapi reaction failed (${res.status}): ${JSON.stringify(data)}`);
  }

  return data;
}
