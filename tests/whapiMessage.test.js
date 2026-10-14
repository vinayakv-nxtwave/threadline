// Every Whapi message shape we've seen on the support number (field names
// taken from the real channel, content invented). Run: npm test
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { normalizeWhapiMessage as norm } from "../src/services/whapiMessage.js";

const base = (extra) => ({ id: "MSG1", from_me: false, chat_id: "919876543210@s.whatsapp.net", from: "919876543210", from_name: "Priya", timestamp: 1791900000, ...extra });

describe("kept as student messages (never dropped)", () => {
  test("text", () => {
    const r = norm(base({ type: "text", text: { body: "class link not working" } }));
    assert.equal(r.kind, "message");
    assert.equal(r.text, "class link not working");
    assert.equal(r.phone, "919876543210");
    assert.equal(r.name, "Priya");
    assert.equal(r.receivedAt.toISOString(), new Date(1791900000 * 1000).toISOString());
  });
  test("link_preview (any text containing a link) -- was being DROPPED before", () => {
    const r = norm(base({ type: "link_preview", link_preview: { body: "see https://x.y/z", url: "https://x.y/z", title: "Z" } }));
    assert.equal(r.kind, "message");
    assert.equal(r.type, "text");
    assert.equal(r.text, "see https://x.y/z");
  });
  test("link_preview whose body lacks the url gets the url appended", () => {
    assert.equal(norm(base({ type: "link_preview", link_preview: { body: "look", url: "https://a.b" } })).text, "look\nhttps://a.b");
  });
  test("contact card -- was being DROPPED before", () => {
    const r = norm(base({ type: "contact", contact: { name: "Ravi", vcard: "BEGIN:VCARD\nTEL;type=CELL:+91 98765 43210\nEND:VCARD" } }));
    assert.equal(r.text, "📇 Contact shared: Ravi (+91 98765 43210)");
  });
  test("location", () => {
    const r = norm(base({ type: "location", location: { latitude: 17.4, longitude: 78.5, name: "Office" } }));
    assert.equal(r.text, "📍 Location: Office\nhttps://maps.google.com/?q=17.4,78.5");
  });
  test("gif / video note are stored as video", () => {
    assert.equal(norm(base({ type: "gif", gif: { link: "https://m/g.mp4" } })).type, "video");
    assert.equal(norm(base({ type: "short", short: { link: "https://m/s.mp4" } })).type, "video");
  });
  test("image keeps its link and caption", () => {
    const r = norm(base({ type: "image", image: { link: "https://m/i.jpg", mime_type: "image/jpeg", caption: "error screen" } }));
    assert.deepEqual([r.type, r.mediaUrl, r.caption, r.text], ["image", "https://m/i.jpg", "error screen", "error screen"]);
  });
  test("document uses file_name when filename is missing", () => {
    assert.equal(norm(base({ type: "document", document: { link: "https://m/d.pdf", file_name: "fee.pdf" } })).filename, "fee.pdf");
  });
  test("image with no media object -> placeholder, not dropped", () => {
    const r = norm(base({ type: "image" }));
    assert.equal(r.kind, "message");
    assert.match(r.text, /open WhatsApp/);
  });
  test("empty text -> placeholder, not dropped", () => {
    assert.match(norm(base({ type: "text", text: { body: "  " } })).text, /open WhatsApp/);
  });
  test("button reply", () => {
    assert.equal(norm(base({ type: "reply", reply: { buttons_reply: { title: "Yes, reschedule" } } })).text, "Yes, reschedule");
  });
  test("completely unknown type -> placeholder naming the type", () => {
    const r = norm(base({ type: "hologram" }));
    assert.equal(r.kind, "message");
    assert.match(r.text, /^\[hologram message/);
  });
  test("our own message from the phone keeps from_me and the CUSTOMER's number", () => {
    const r = norm(base({ from_me: true, from: "918000000000", type: "text", text: { body: "hi" } }));
    assert.equal(r.fromMe, true);
    assert.equal(r.phone, "919876543210");
    assert.equal(r.name, null);
  });
  test("quoted reply id is carried through", () => {
    assert.equal(norm(base({ type: "text", text: { body: "this" }, context: { quoted_id: "Q1" } })).quotedWhapiId, "Q1");
  });
});

test("LID chat (WhatsApp privacy ID) is a 1:1 student chat, kept", () => {
  assert.equal(norm(base({ chat_id: "123456@lid", type: "text", text: { body: "x" } })).kind, "message");
});

describe("special actions", () => {
  test("reaction", () => {
    assert.deepEqual(norm(base({ type: "action", action: { type: "reaction", target: "T1", emoji: "👍" } })), { kind: "reaction", target: "T1", emoji: "👍" });
  });
  test("edit updates the original message's text", () => {
    assert.deepEqual(
      norm(base({ type: "action", action: { type: "edit", target: "T1", edited_type: "text", edited_content: { body: "fixed typo" } } })),
      { kind: "edit", target: "T1", body: "fixed typo" }
    );
  });
});

describe("skipped on purpose (not student messages)", () => {
  test("group chat", () => assert.equal(norm(base({ chat_id: "1203@g.us", type: "text", text: { body: "x" } })).kind, "skip"));
  test("system notice", () => assert.equal(norm(base({ type: "system", subtype: "x" })).kind, "skip"));
  test("delete action", () => assert.equal(norm(base({ type: "action", action: { type: "delete", target: "T" } })).kind, "skip"));
  test("label change", () => assert.equal(norm(base({ type: "action", action: { type: "label_change" } })).kind, "skip"));
  test("newsletter / broadcast chats", () => {
    assert.equal(norm(base({ chat_id: "status@broadcast", type: "text", text: { body: "x" } })).kind, "skip");
  });
});
