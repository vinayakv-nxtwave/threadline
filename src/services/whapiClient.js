import dotenv from "dotenv";
dotenv.config();

const WHAPI_BASE = "https://gate.whapi.cloud";
const TOKEN = process.env.WHAPI_TOKEN;

/**
 * Sends a plain text WhatsApp message via Whapi.Cloud.
 * @param {string} phone - Recipient number in international format, digits only (no "+").
 * @param {string} body - Message text.
 */
export async function sendText(phone, body) {
  if (!TOKEN) {
    throw new Error("WHAPI_TOKEN is not set. Add it to your .env file.");
  }

  const res = await fetch(`${WHAPI_BASE}/messages/text`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({ to: phone, body }),
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
