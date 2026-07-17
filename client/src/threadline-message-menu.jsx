import { useState, useRef, useEffect } from "react";
import {
  MoreVertical, Info, Reply as ReplyIcon, Copy, Smile, Forward, Pin, PinOff,
  Star, Sparkles, Trash2, X, Search, ArrowLeft,
} from "lucide-react";
import EmojiPicker from "emoji-picker-react";
import { api } from "./threadline-crm.jsx";

/**
 * The "⋮" context menu on a message bubble, covering: info, reply (quote),
 * copy, react, forward, pin, star, Ask AI, and delete (soft). Mutating
 * actions call the backend then `onChanged()` so the parent refetches the
 * ticket detail -- no local message-list bookkeeping lives here.
 */
export default function MessageMenu({ message, ticketId, tickets, C, onReply, onChanged, onDeleted }) {
  const [panel, setPanel] = useState(null); // null | 'menu' | 'info' | 'react' | 'forward' | 'askai'
  const [askQuestion, setAskQuestion] = useState("");
  const [askAnswer, setAskAnswer] = useState(null);
  const [askLoading, setAskLoading] = useState(false);
  const [forwardSearch, setForwardSearch] = useState("");
  const [forwardSending, setForwardSending] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!panel) return;
    const onClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) close();
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [panel]);

  const close = () => {
    setPanel(null);
    setAskQuestion("");
    setAskAnswer(null);
    setForwardSearch("");
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message.body || message.caption || "");
    close();
  };

  const handleReply = () => {
    onReply(message);
    close();
  };

  const handleReact = async (emoji) => {
    try {
      await api(`/api/tickets/${ticketId}/messages/${message.id}/react`, {
        method: "POST",
        body: JSON.stringify({ emoji }),
      });
      onChanged();
    } catch (err) {
      // swallow -- the emoji picker's own UI doesn't have room for an error state
    }
    close();
  };

  const togglePin = async () => {
    await api(`/api/tickets/${ticketId}/messages/${message.id}/pin`, {
      method: "PATCH",
      body: JSON.stringify({ pinned: !message.pinned }),
    });
    onChanged();
    close();
  };

  const toggleStar = async () => {
    await api(`/api/tickets/${ticketId}/messages/${message.id}/star`, {
      method: "PATCH",
      body: JSON.stringify({ starred: !message.starred }),
    });
    onChanged();
    close();
  };

  const handleDelete = async () => {
    await api(`/api/tickets/${ticketId}/messages/${message.id}`, { method: "DELETE" });
    onDeleted?.(message.id);
    onChanged();
    close();
  };

  const handleAsk = async () => {
    setAskLoading(true);
    setAskAnswer(null);
    try {
      const res = await api(`/api/tickets/${ticketId}/ask-ai`, {
        method: "POST",
        body: JSON.stringify({ question: askQuestion.trim() || undefined }),
      });
      setAskAnswer(res.answer);
    } catch (err) {
      setAskAnswer(`Couldn't get an answer: ${err.message}`);
    } finally {
      setAskLoading(false);
    }
  };

  const handleForward = async (targetTicketId) => {
    setForwardSending(true);
    try {
      await api(`/api/tickets/${ticketId}/messages/${message.id}/forward`, {
        method: "POST",
        body: JSON.stringify({ targetTicketId }),
      });
      close();
    } catch (err) {
      // leave the forward panel open so the agent can see something went wrong
    } finally {
      setForwardSending(false);
    }
  };

  const forwardCandidates = (tickets || [])
    .filter((t) => t.id !== ticketId)
    .filter((t) =>
      forwardSearch.trim() === ""
        ? true
        : ((t.student_name || "") + t.student_phone + t.ticket_no)
            .toLowerCase()
            .includes(forwardSearch.toLowerCase())
    )
    .slice(0, 8);

  const menuItemStyle = {
    color: C.ink,
  };

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        onClick={() => setPanel(panel ? null : "menu")}
        title="More"
        className={`message-menu-trigger transition-opacity w-6 h-6 rounded flex items-center justify-center hover:bg-black/10 ${
          panel ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        }`}
        style={{ color: "inherit" }}
      >
        <MoreVertical size={14} />
      </button>

      {panel && (
        <div
          style={{ background: C.card, border: `1px solid ${C.line}`, color: C.ink, width: 240 }}
          className="absolute z-50 top-full mt-1 right-0 rounded-xl shadow-lg overflow-hidden text-sm"
        >
          {panel === "menu" && (
            <div className="py-1">
              <button
                onClick={() => setPanel("info")}
                style={menuItemStyle}
                className="w-full text-left px-3 py-2 flex items-center gap-2.5 hover:bg-black/5 text-xs"
              >
                <Info size={13} /> Message info
              </button>
              <button
                onClick={handleReply}
                style={menuItemStyle}
                className="w-full text-left px-3 py-2 flex items-center gap-2.5 hover:bg-black/5 text-xs"
              >
                <ReplyIcon size={13} /> Reply
              </button>
              <button
                onClick={handleCopy}
                style={menuItemStyle}
                className="w-full text-left px-3 py-2 flex items-center gap-2.5 hover:bg-black/5 text-xs"
              >
                <Copy size={13} /> Copy
              </button>
              <button
                onClick={() => setPanel("react")}
                style={menuItemStyle}
                className="w-full text-left px-3 py-2 flex items-center gap-2.5 hover:bg-black/5 text-xs"
              >
                <Smile size={13} /> React
              </button>
              <button
                onClick={() => setPanel("forward")}
                style={menuItemStyle}
                className="w-full text-left px-3 py-2 flex items-center gap-2.5 hover:bg-black/5 text-xs"
              >
                <Forward size={13} /> Forward
              </button>
              <button
                onClick={togglePin}
                style={menuItemStyle}
                className="w-full text-left px-3 py-2 flex items-center gap-2.5 hover:bg-black/5 text-xs"
              >
                {message.pinned ? <PinOff size={13} /> : <Pin size={13} />}
                {message.pinned ? "Unpin" : "Pin"}
              </button>
              <button
                onClick={toggleStar}
                style={menuItemStyle}
                className="w-full text-left px-3 py-2 flex items-center gap-2.5 hover:bg-black/5 text-xs"
              >
                <Star size={13} fill={message.starred ? C.amber : "none"} color={message.starred ? C.amber : C.ink} />
                {message.starred ? "Unstar" : "Star"}
              </button>
              <button
                onClick={() => setPanel("askai")}
                style={menuItemStyle}
                className="w-full text-left px-3 py-2 flex items-center gap-2.5 hover:bg-black/5 text-xs"
              >
                <Sparkles size={13} /> Ask AI
              </button>
              <div style={{ borderTop: `1px solid ${C.line}` }} className="my-1" />
              <button
                onClick={handleDelete}
                style={{ color: C.coral }}
                className="w-full text-left px-3 py-2 flex items-center gap-2.5 hover:bg-black/5 text-xs"
              >
                <Trash2 size={13} /> Delete
              </button>
            </div>
          )}

          {panel === "info" && (
            <div className="p-3">
              <div className="flex items-center justify-between mb-2">
                <button onClick={() => setPanel("menu")} className="flex items-center gap-1.5 text-xs font-medium">
                  <ArrowLeft size={13} /> Message info
                </button>
                <button onClick={close}>
                  <X size={13} color={C.slateLight} />
                </button>
              </div>
              <div className="text-xs space-y-1.5" style={{ color: C.slate }}>
                <div>Sent: {new Date(message.created_at).toLocaleString()}</div>
                <div>Direction: {message.direction === "inbound" ? "Received from student" : "Sent by agent"}</div>
                <div className="mono truncate">Whapi ID: {message.whapi_message_id || "—"}</div>
                <div>Status: {message.delivery_status || "sent"}</div>
              </div>
            </div>
          )}

          {panel === "react" && (
            <div>
              <div className="flex items-center justify-between px-3 pt-2">
                <button onClick={() => setPanel("menu")} className="flex items-center gap-1.5 text-xs font-medium">
                  <ArrowLeft size={13} /> React
                </button>
                <button onClick={close}>
                  <X size={13} color={C.slateLight} />
                </button>
              </div>
              {message.reaction && (
                <button
                  onClick={() => handleReact("")}
                  style={{ color: C.coral }}
                  className="w-full text-left px-3 py-1.5 text-xs"
                >
                  Remove current reaction ({message.reaction})
                </button>
              )}
              <EmojiPicker onEmojiClick={(e) => handleReact(e.emoji)} />
            </div>
          )}

          {panel === "forward" && (
            <div className="p-3">
              <div className="flex items-center justify-between mb-2">
                <button onClick={() => setPanel("menu")} className="flex items-center gap-1.5 text-xs font-medium">
                  <ArrowLeft size={13} /> Forward to…
                </button>
                <button onClick={close}>
                  <X size={13} color={C.slateLight} />
                </button>
              </div>
              <div
                style={{ background: C.paperDim }}
                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 mb-2"
              >
                <Search size={12} color={C.slateLight} />
                <input
                  autoFocus
                  value={forwardSearch}
                  onChange={(e) => setForwardSearch(e.target.value)}
                  placeholder="Search ticket, name, phone"
                  style={{ background: "transparent", color: C.ink }}
                  className="text-xs outline-none flex-1"
                />
              </div>
              <div className="max-h-40 overflow-y-auto space-y-1">
                {forwardCandidates.length === 0 && (
                  <div className="text-xs px-1" style={{ color: C.slateLight }}>
                    No matching tickets.
                  </div>
                )}
                {forwardCandidates.map((t) => (
                  <button
                    key={t.id}
                    disabled={forwardSending}
                    onClick={() => handleForward(t.id)}
                    className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-black/5 text-xs"
                  >
                    <div className="font-medium">{t.student_name || "Unknown"}</div>
                    <div className="mono" style={{ color: C.slateLight }}>
                      {t.ticket_no} · {t.student_phone}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {panel === "askai" && (
            <div className="p-3">
              <div className="flex items-center justify-between mb-2">
                <button onClick={() => setPanel("menu")} className="flex items-center gap-1.5 text-xs font-medium">
                  <ArrowLeft size={13} /> Ask AI
                </button>
                <button onClick={close}>
                  <X size={13} color={C.slateLight} />
                </button>
              </div>
              <input
                value={askQuestion}
                onChange={(e) => setAskQuestion(e.target.value)}
                placeholder="Ask a question, or leave blank to summarize"
                style={{ background: C.paperDim, color: C.ink }}
                className="w-full text-xs rounded-lg px-2.5 py-2 outline-none mb-2"
              />
              <button
                onClick={handleAsk}
                disabled={askLoading}
                style={{ background: C.green, opacity: askLoading ? 0.6 : 1 }}
                className="w-full text-xs font-medium text-white py-1.5 rounded-lg mb-2"
              >
                {askLoading ? "Asking…" : askQuestion.trim() ? "Ask" : "Summarize ticket"}
              </button>
              {askAnswer && (
                <div
                  style={{ background: C.paperDim, color: C.ink }}
                  className="text-xs rounded-lg p-2.5 max-h-48 overflow-y-auto whitespace-pre-wrap"
                >
                  {askAnswer}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
