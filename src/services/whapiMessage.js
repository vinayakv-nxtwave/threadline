// Turns one raw Whapi message into what we store -- pure, no database, so
// every shape is covered by tests/whapiMessage.test.js. Used by both the
// webhook and the catch-up sync (whapiSync.js), so they can never disagree.
//
// Rule: a message from a student is NEVER silently dropped. Types we can't
// display become a text placeholder, so a ticket is still created/updated
// and the team knows to look at WhatsApp. Only things that aren't student
// messages at all (group chats, system notices, label changes) are skipped.

const MEDIA_TYPES = ["image", "video", "document", "audio", "voice", "sticker"];
// Whapi types that are really videos (GIF, round "video note")
const VIDEO_ALIASES = ["gif", "short", "ptv"];

// @lid = WhatsApp's newer privacy ID for a person -- still a 1:1 chat with a student
const isOneToOne = (chatId) =>
  !!chatId && (chatId.endsWith("@s.whatsapp.net") || chatId.endsWith("@c.us") || chatId.endsWith("@lid"));

/** Phone number from a vCard's TEL line, if any. */
function vcardPhone(vcard) {
  const m = /TEL[^:]*:([+\d][\d\s-]+)/i.exec(vcard || "");
  return m ? m[1].trim() : null;
}

function placeholder(type) {
  return `[${type || "unknown"} message — this type can't be shown here, open WhatsApp on the support phone to view it]`;
}

/**
 * @returns one of:
 *   { kind: "skip", reason }
 *   { kind: "reaction", target, emoji }
 *   { kind: "edit", target, body }
 *   { kind: "message", fromMe, phone, name, receivedAt, whapiMessageId, quotedWhapiId,
 *     type, text, mediaUrl, mimeType, filename, caption }
 */
export function normalizeWhapiMessage(msg) {
  if (!msg || !msg.id) return { kind: "skip", reason: "no id" };
  const chatId = msg.chat_id || "";
  if (chatId.endsWith("@g.us")) return { kind: "skip", reason: "group chat" };
  if (!isOneToOne(chatId)) return { kind: "skip", reason: `not a 1:1 chat (${chatId.split("@")[1] || "none"})` };

  if (msg.type === "action") {
    const a = msg.action || {};
    if (a.type === "reaction") return { kind: "reaction", target: a.target, emoji: a.emoji || null };
    if (a.type === "edit" && a.target) {
      return { kind: "edit", target: a.target, body: a.edited_content?.body ?? null };
    }
    return { kind: "skip", reason: `action:${a.type || "unknown"}` }; // delete, label_change, ...
  }
  if (msg.type === "system") return { kind: "skip", reason: "system notice" };

  const base = {
    kind: "message",
    fromMe: !!msg.from_me,
    // chat_id is the customer's number in both directions (from is our own number when from_me)
    phone: chatId.split("@")[0].replace(/\D/g, ""),
    name: msg.from_me ? null : msg.from_name || null,
    receivedAt: msg.timestamp ? new Date(msg.timestamp * 1000) : null,
    whapiMessageId: msg.id,
    quotedWhapiId: msg.context?.quoted_id || null,
    type: "text",
    text: null,
    mediaUrl: null,
    mimeType: null,
    filename: null,
    caption: null,
  };
  const t = msg.type;

  if (t === "text") {
    const body = msg.text?.body;
    return { ...base, text: body && body.trim() ? body : placeholder("empty text") };
  }
  if (t === "link_preview" || t === "group_invite") {
    const lp = msg[t] || {};
    let text = lp.body || lp.title || "";
    if (lp.url && !text.includes(lp.url)) text = text ? `${text}\n${lp.url}` : lp.url;
    return { ...base, text: text || placeholder(t) };
  }
  if (MEDIA_TYPES.includes(t) || VIDEO_ALIASES.includes(t)) {
    const media = msg[t];
    if (!media) return { ...base, text: placeholder(t) };
    return {
      ...base,
      type: VIDEO_ALIASES.includes(t) ? "video" : t,
      mediaUrl: media.link || null,
      mimeType: media.mime_type || null,
      filename: media.filename || media.file_name || null,
      caption: media.caption || null,
      text: media.caption || null,
    };
  }
  if (t === "contact") {
    const c = msg.contact || {};
    const phone = vcardPhone(c.vcard);
    return { ...base, text: `📇 Contact shared: ${c.name || "unknown"}${phone ? ` (${phone})` : ""}` };
  }
  if (t === "contact_list") {
    const list = msg.contact_list?.list || [];
    const lines = list.map((c) => `${c.name || "unknown"}${vcardPhone(c.vcard) ? ` (${vcardPhone(c.vcard)})` : ""}`);
    return { ...base, text: `📇 Contacts shared:\n${lines.join("\n") || "(none)"}` };
  }
  if (t === "location" || t === "live_location") {
    const l = msg[t] || {};
    const where = [l.name, l.address].filter(Boolean).join(", ");
    const map = l.latitude != null && l.longitude != null ? `https://maps.google.com/?q=${l.latitude},${l.longitude}` : "";
    return { ...base, text: `📍 ${t === "live_location" ? "Live location" : "Location"}${where ? `: ${where}` : ""}${map ? `\n${map}` : ""}` };
  }
  if (t === "poll") {
    const p = msg.poll || {};
    const opts = (p.options || []).map((o) => `• ${typeof o === "string" ? o : o.name}`).join("\n");
    return { ...base, text: `📊 Poll: ${p.title || ""}${opts ? `\n${opts}` : ""}` };
  }
  if (t === "reply" || t === "interactive" || t === "buttons" || t === "list") {
    // button / list replies: pick whatever human-readable text Whapi gives us
    const r = msg[t] || {};
    const text =
      r.buttons_reply?.title || r.list_reply?.title || r.title || r.body?.text || r.body || r.text || null;
    return { ...base, text: typeof text === "string" && text.trim() ? text : placeholder(t) };
  }
  return { ...base, text: placeholder(t) };
}
