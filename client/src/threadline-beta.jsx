import { useState } from "react";
import { FlaskConical, Send, X } from "lucide-react";
import { C, api } from "./threadline-crm.jsx";

// Strip shown only on the beta dashboard (VITE_APP_ENV=beta), so nobody ever
// mistakes it for production -- plus a way to fake inbound student messages,
// since beta has no WhatsApp channel of its own.
export default function BetaBanner({ onSimulated, onError }) {
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState("919000000001");
  const [name, setName] = useState("Beta Student");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      const res = await api("/api/dev/simulate-inbound", {
        method: "POST",
        body: JSON.stringify({ phone, name, text }),
      });
      setText("");
      onSimulated?.(res);
    } catch (err) {
      onError?.(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ background: C.amber, color: C.ink }} className="text-xs px-6 py-1.5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 font-medium">
          <FlaskConical size={13} />
          BETA environment · test data only · replies are NOT sent to WhatsApp
        </div>
        <button
          onClick={() => setOpen((o) => !o)}
          style={{ background: C.ink, color: "#fff" }}
          className="px-2.5 py-1 rounded-full font-medium flex items-center gap-1"
        >
          {open ? <X size={11} /> : <Send size={11} />}
          {open ? "Close" : "Simulate student message"}
        </button>
      </div>
      {open && (
        <form onSubmit={submit} className="flex items-center gap-2 mt-1.5 mb-1 flex-wrap">
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Phone"
            style={{ background: "#fff" }}
            className="rounded px-2 py-1 outline-none mono w-32"
          />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            style={{ background: "#fff" }}
            className="rounded px-2 py-1 outline-none w-32"
          />
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Message text"
            style={{ background: "#fff" }}
            className="rounded px-2 py-1 outline-none flex-1 min-w-[200px]"
          />
          <button
            type="submit"
            disabled={busy || !text.trim()}
            style={{ background: C.ink, color: "#fff", opacity: busy || !text.trim() ? 0.6 : 1 }}
            className="px-3 py-1 rounded font-medium"
          >
            {busy ? "Sending…" : "Send as student"}
          </button>
        </form>
      )}
    </div>
  );
}
