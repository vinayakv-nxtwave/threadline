import { useState, useRef, useEffect } from "react";
import {
  Search, Lock, Unlock, CheckCircle2, Clock, AlertTriangle, Send,
  Phone, Calendar, ChevronDown, X, Circle, MessageCircle, Tag as TagIcon, LogOut,
  Smile, Paperclip, Mic,
} from "lucide-react";
import EmojiPicker from "emoji-picker-react";
import AnalyticsView from "./threadline-analytics.jsx";

export const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";
const POLL_MS = 4000;
export const TOKEN_KEY = "threadline_token";

export const C = {
  ink: "#14213D",
  inkSoft: "#1E2C4F",
  paper: "#FAF9F6",
  paperDim: "#F1EEE6",
  card: "#FFFFFF",
  slate: "#5C6470",
  slateLight: "#9AA1AC",
  green: "#2F9E6E",
  greenDark: "#227A55",
  greenTint: "#E6F3EC",
  amber: "#E8A33D",
  amberTint: "#FBF0DE",
  coral: "#E2604F",
  coralTint: "#FBE7E3",
  line: "#E4E1D8",
};

export const STATUS = {
  new: { label: "New", color: C.coral, tint: C.coralTint },
  open: { label: "Open", color: C.green, tint: C.greenTint },
  pending: { label: "Pending", color: C.amber, tint: C.amberTint },
  resolved: { label: "Resolved", color: C.greenDark, tint: C.greenTint },
  closed: { label: "Closed", color: C.slate, tint: C.paperDim },
};

export const PRIORITY = {
  urgent: { label: "Urgent", color: C.coral },
  high: { label: "High", color: "#C97A2E" },
  medium: { label: "Medium", color: C.amber },
  low: { label: "Low", color: C.slateLight },
};

export const CATEGORY = {
  technical: { label: "Technical Issue", color: "#2C8FC9" },
  doubt: { label: "Doubt Resolution", color: "#6D5DD3" },
  session: { label: "Live Session / Mentor", color: "#4D7C0F" },
  payment: { label: "Payments & EMI", color: "#0D9488" },
  certificate: { label: "Certificate & Placement", color: "#B4571F" },
  access: { label: "Account Access", color: "#B4275B" },
  general: { label: "General", color: "#7A7F8C" },
};

function timeAgo(ts) {
  const diff = Math.max(0, Math.floor((Date.now() - ts) / 60000));
  if (diff < 1) return "just now";
  if (diff < 60) return `${diff}m ago`;
  const h = Math.floor(diff / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function initials(name) {
  if (!name) return "?";
  return name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

export function formatDuration(seconds) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

export async function api(path, options = {}) {
  const token = localStorage.getItem(TOKEN_KEY);
  const headers = { "content-type": "application/json", ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));

  if (res.status === 401) {
    localStorage.removeItem(TOKEN_KEY);
    const err = new Error(data.error || "Session expired, please sign in again");
    err.unauthorized = true;
    throw err;
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// Multipart upload for media replies — can't reuse api() since it always sets
// content-type: application/json, which breaks FormData's auto boundary header.
async function sendFileReply(ticketId, file, caption, isVoiceNote) {
  const token = localStorage.getItem(TOKEN_KEY);
  const form = new FormData();
  form.append("file", file);
  if (caption) form.append("body", caption);
  if (isVoiceNote) form.append("isVoiceNote", "true");

  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_URL}/api/tickets/${ticketId}/reply`, {
    method: "POST",
    headers,
    body: form,
  });
  const data = await res.json().catch(() => ({}));

  if (res.status === 401) {
    localStorage.removeItem(TOKEN_KEY);
    const err = new Error(data.error || "Session expired, please sign in again");
    err.unauthorized = true;
    throw err;
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export default function ThreadlineCRM() {
  const [view, setView] = useState("tickets"); // "tickets" | "analytics"
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [tickets, setTickets] = useState([]);
  const [stats, setStats] = useState({ avgResolutionSeconds: null, avgTurnaroundSeconds: null });
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedDetail, setSelectedDetail] = useState(null);
  const [filter, setFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [notesDraft, setNotesDraft] = useState("");
  const [toast, setToast] = useState(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [recording, setRecording] = useState(false);
  const threadEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3200);
  };

  const handleLogout = () => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setTickets([]);
    setSelectedId(null);
    setSelectedDetail(null);
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoggingIn(true);
    setLoginError("");
    try {
      const res = await fetch(`${API_URL}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: loginPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Login failed");
      localStorage.setItem(TOKEN_KEY, data.token);
      setToken(data.token);
      setLoginPassword("");
    } catch (err) {
      setLoginError(err.message);
    } finally {
      setLoggingIn(false);
    }
  };

  const fetchTickets = async () => {
    try {
      const data = await api("/api/tickets");
      setTickets(data);
      setConnected(true);
    } catch (err) {
      if (err.unauthorized) return handleLogout();
      setConnected(false);
      if (loading) showToast(`Can't reach Threadline API at ${API_URL}`);
    } finally {
      setLoading(false);
    }
  };

  const fetchDetail = async (id) => {
    try {
      const data = await api(`/api/tickets/${id}`);
      setSelectedDetail(data);
    } catch (err) {
      if (err.unauthorized) return handleLogout();
      setConnected(false);
    }
  };

  const fetchStats = async () => {
    try {
      const data = await api("/api/tickets/stats/summary");
      setStats(data);
    } catch (err) {
      if (err.unauthorized) return handleLogout();
    }
  };

  useEffect(() => {
    if (!token) return;
    fetchTickets();
    fetchStats();
    const id = setInterval(() => {
      fetchTickets();
      fetchStats();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [token]);

  useEffect(() => {
    if (!selectedId && tickets.length > 0) setSelectedId(tickets[0].id);
  }, [tickets, selectedId]);

  useEffect(() => {
    if (!token || !selectedId) return;
    fetchDetail(selectedId);
    const id = setInterval(() => fetchDetail(selectedId), POLL_MS);
    return () => clearInterval(id);
  }, [token, selectedId]);

  useEffect(() => {
    setNotesDraft(selectedDetail?.notes || "");
  }, [selectedDetail?.id]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [selectedDetail?.id, selectedDetail?.messages?.length]);

  const updateTicket = async (id, patch) => {
    try {
      const updated = await api(`/api/tickets/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      setTickets((prev) => prev.map((t) => (t.id === id ? { ...t, ...updated } : t)));
      setSelectedDetail((prev) => (prev && prev.id === id ? { ...prev, ...updated } : prev));
    } catch (err) {
      if (err.unauthorized) return handleLogout();
      showToast(err.message);
    }
  };

  const saveNotesIfChanged = () => {
    if (!selectedDetail) return;
    if (notesDraft !== (selectedDetail.notes || "")) {
      updateTicket(selectedDetail.id, { notes: notesDraft });
    }
  };

  const handleSend = async () => {
    if (!draft.trim() || !selectedDetail || sending) return;
    setSending(true);
    try {
      await api(`/api/tickets/${selectedDetail.id}/reply`, {
        method: "POST",
        body: JSON.stringify({ body: draft.trim() }),
      });
      setDraft("");
      await fetchDetail(selectedDetail.id);
      await fetchTickets();
    } catch (err) {
      if (err.unauthorized) return handleLogout();
      showToast(err.message);
    } finally {
      setSending(false);
    }
  };

  const handleFileSelected = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset so picking the same file again still fires onChange
    if (!file || !selectedDetail || sending) return;

    setSending(true);
    try {
      await sendFileReply(selectedDetail.id, file, draft.trim() || undefined, false);
      setDraft("");
      await fetchDetail(selectedDetail.id);
      await fetchTickets();
    } catch (err) {
      if (err.unauthorized) return handleLogout();
      showToast(err.message);
    } finally {
      setSending(false);
    }
  };

  const startRecording = async () => {
    if (!selectedDetail || sending || recording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => e.data.size > 0 && audioChunksRef.current.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        if (blob.size === 0 || !selectedDetail) return;

        setSending(true);
        try {
          await sendFileReply(selectedDetail.id, new File([blob], "voice-note.webm", { type: "audio/webm" }), null, true);
          await fetchDetail(selectedDetail.id);
          await fetchTickets();
        } catch (err) {
          if (err.unauthorized) return handleLogout();
          showToast(err.message);
        } finally {
          setSending(false);
        }
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setRecording(true);
    } catch (err) {
      showToast("Microphone access denied or unavailable.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setRecording(false);
  };

  const handleMarkResolved = (ticket) => {
    updateTicket(ticket.id, { status: "resolved" });
    showToast(`${ticket.ticket_no} marked resolved. You can close it now.`);
  };

  const handleClose = (ticket) => {
    if (ticket.status !== "resolved") return;
    updateTicket(ticket.id, { status: "closed" });
    showToast(`${ticket.ticket_no} closed.`);
  };

  const filtered = tickets
    .filter((t) => (filter === "all" ? true : t.status === filter))
    .filter((t) => (categoryFilter === "all" ? true : t.category === categoryFilter))
    .filter((t) =>
      search.trim() === ""
        ? true
        : ((t.student_name || "") + t.student_phone + t.ticket_no)
            .toLowerCase()
            .includes(search.toLowerCase())
    );

  const counts = tickets.reduce((acc, t) => {
    acc[t.status] = (acc[t.status] || 0) + 1;
    return acc;
  }, {});
  counts.all = tickets.length;

  const statBar = [
    { label: "Open", value: counts.open || 0, color: C.green },
    { label: "Pending", value: counts.pending || 0, color: C.amber },
    { label: "New", value: counts.new || 0, color: C.coral },
    {
      label: "Avg Turnaround",
      value: stats.avgTurnaroundSeconds != null ? formatDuration(stats.avgTurnaroundSeconds) : "—",
      color: C.slateLight,
    },
  ];

  const selected = selectedDetail;

  if (!token) {
    return (
      <div
        style={{ fontFamily: "'Inter', sans-serif", background: C.paper, color: C.ink }}
        className="w-full h-full min-h-screen flex items-center justify-center px-4"
      >
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Space+Grotesk:wght@500;600;700&display=swap');
          .display { font-family: 'Space Grotesk', sans-serif; }
        `}</style>
        <form
          onSubmit={handleLogin}
          style={{ background: C.card, border: `1px solid ${C.line}` }}
          className="w-full max-w-sm rounded-xl p-6 space-y-4 shadow-sm"
        >
          <div className="flex items-center gap-2 mb-2">
            <div style={{ background: C.green }} className="w-8 h-8 rounded-md flex items-center justify-center">
              <MessageCircle size={17} color="#fff" strokeWidth={2.2} />
            </div>
            <span className="display text-lg font-semibold tracking-tight">Threadline</span>
          </div>
          <div>
            <label className="text-xs font-medium" style={{ color: C.slate }}>
              Dashboard password
            </label>
            <input
              type="password"
              autoFocus
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              style={{ background: C.paperDim, color: C.ink }}
              className="w-full mt-1 text-sm rounded-lg px-3 py-2.5 outline-none"
            />
          </div>
          {loginError && (
            <div className="text-xs" style={{ color: C.coral }}>
              {loginError}
            </div>
          )}
          <button
            type="submit"
            disabled={loggingIn || !loginPassword}
            style={{ background: C.green, opacity: loggingIn || !loginPassword ? 0.6 : 1 }}
            className="w-full text-sm font-medium text-white py-2.5 rounded-lg"
          >
            {loggingIn ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div
      style={{ fontFamily: "'Inter', sans-serif", background: C.paper, color: C.ink }}
      className="w-full h-screen flex flex-col"
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Space+Grotesk:wght@500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
        .mono { font-family: 'JetBrains Mono', monospace; }
        .display { font-family: 'Space Grotesk', sans-serif; }
        .scrollbar-thin::-webkit-scrollbar { width: 6px; }
        .scrollbar-thin::-webkit-scrollbar-thumb { background: ${C.line}; border-radius: 4px; }
        .ticket-row:hover { background: ${C.paperDim}; }
      `}</style>

      {/* Header */}
      <div
        style={{ background: C.ink, borderBottom: `1px solid ${C.inkSoft}` }}
        className="flex items-center justify-between px-6 py-3 flex-wrap gap-3"
      >
        <div className="flex items-center gap-3">
          <div
            style={{ background: C.green }}
            className="w-8 h-8 rounded-md flex items-center justify-center"
          >
            <MessageCircle size={17} color="#fff" strokeWidth={2.2} />
          </div>
          <span className="display text-white text-lg font-semibold tracking-tight">Threadline</span>
          <div
            style={{ background: C.inkSoft, color: C.slateLight }}
            className="hidden sm:flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full mono"
          >
            <Circle size={7} fill={connected ? C.green : C.coral} color={connected ? C.green : C.coral} />
            {connected ? "API connected · Launchpad Support Line" : "API unreachable"}
          </div>
          <div className="flex gap-1.5">
            {[
              { key: "tickets", label: "Tickets" },
              { key: "analytics", label: "Analytics" },
            ].map((v) => (
              <button
                key={v.key}
                onClick={() => setView(v.key)}
                style={{
                  background: view === v.key ? C.green : C.inkSoft,
                  color: view === v.key ? "#fff" : C.slateLight,
                }}
                className="text-xs px-3 py-1.5 rounded-full font-medium transition-colors"
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-4">
          {statBar.map((s) => (
            <div key={s.label} className="text-right hidden md:block">
              <div className="mono text-sm font-medium text-white leading-none">{s.value}</div>
              <div style={{ color: C.slateLight }} className="text-[10px] uppercase tracking-wide mt-0.5">
                {s.label}
              </div>
            </div>
          ))}
          <button
            onClick={handleLogout}
            title="Sign out"
            style={{ color: C.slateLight }}
            className="p-1.5 rounded-md hover:bg-white/10 transition-colors"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>

      {/* Body */}
      {view === "analytics" ? (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <AnalyticsView
            onUnauthorized={handleLogout}
            onViewTicket={(id) => {
              setSelectedId(id);
              setView("tickets");
            }}
          />
        </div>
      ) : (
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Sidebar */}
        <div
          style={{ borderRight: `1px solid ${C.line}`, background: C.card, width: 320 }}
          className="flex-shrink-0 flex flex-col min-h-0"
        >
          <div className="p-3" style={{ borderBottom: `1px solid ${C.line}` }}>
            <div
              style={{ background: C.paperDim }}
              className="flex items-center gap-2 rounded-lg px-3 py-2"
            >
              <Search size={15} color={C.slateLight} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, phone, ticket ID"
                style={{ background: "transparent", color: C.ink }}
                className="text-sm outline-none flex-1 placeholder:text-slate-400"
              />
            </div>
            <div className="flex gap-1.5 mt-3 flex-wrap">
              {["all", "new", "open", "pending", "resolved", "closed"].map((f) => {
                const active = filter === f;
                const meta = STATUS[f];
                return (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    style={{
                      background: active ? (meta ? meta.color : C.ink) : C.paperDim,
                      color: active ? "#fff" : C.slate,
                    }}
                    className="text-xs px-2.5 py-1 rounded-full font-medium capitalize transition-colors"
                  >
                    {f} {counts[f] ? <span className="mono opacity-80">{counts[f]}</span> : null}
                  </button>
                );
              })}
            </div>
            <div className="mt-2.5">
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                style={{ background: C.paperDim, color: C.slate, border: "none" }}
                className="w-full text-xs rounded-lg px-2.5 py-1.5 outline-none"
              >
                <option value="all">All categories</option>
                {Object.entries(CATEGORY).map(([key, meta]) => (
                  <option key={key} value={key}>
                    {meta.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto scrollbar-thin">
            {loading && (
              <div className="p-6 text-center text-sm" style={{ color: C.slateLight }}>
                Loading tickets…
              </div>
            )}
            {!loading && filtered.length === 0 && (
              <div className="p-6 text-center text-sm" style={{ color: C.slateLight }}>
                No tickets match this view.
              </div>
            )}
            {filtered.map((t) => {
              const active = t.id === selectedId;
              return (
                <button
                  key={t.id}
                  onClick={() => setSelectedId(t.id)}
                  style={{
                    background: active ? C.paperDim : "transparent",
                    borderLeft: active ? `3px solid ${C.ink}` : "3px solid transparent",
                    borderBottom: `1px solid ${C.line}`,
                  }}
                  className="ticket-row w-full text-left px-4 py-3 flex gap-3 transition-colors"
                >
                  <div
                    style={{ background: C.paperDim, color: C.slate }}
                    className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0 mono"
                  >
                    {initials(t.student_name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium truncate">{t.student_name || "Unknown"}</span>
                      <span className="text-[10px] flex-shrink-0" style={{ color: C.slateLight }}>
                        {timeAgo(new Date(t.last_message_at).getTime())}
                      </span>
                    </div>
                    <div className="text-xs truncate mt-0.5" style={{ color: C.slate }}>
                      {t.last_message_direction === "outbound" ? "You: " : ""}
                      {t.last_message_body || "No messages yet"}
                    </div>
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <span
                        style={{ background: STATUS[t.status].tint, color: STATUS[t.status].color }}
                        className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                      >
                        {STATUS[t.status].label}
                      </span>
                      {(t.priority === "urgent" || t.priority === "high") && (
                        <AlertTriangle size={11} color={PRIORITY[t.priority].color} />
                      )}
                      <span
                        style={{ color: CATEGORY[t.category]?.color }}
                        className="text-[10px] font-medium flex items-center gap-1"
                      >
                        <Circle size={6} fill={CATEGORY[t.category]?.color} color={CATEGORY[t.category]?.color} />
                        {CATEGORY[t.category]?.label || t.category}
                      </span>
                      <span className="mono text-[10px]" style={{ color: C.slateLight }}>
                        {t.ticket_no}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                      <span
                        style={{ color: PRIORITY[t.priority]?.color }}
                        className="text-[10px] font-medium"
                      >
                        {PRIORITY[t.priority]?.label || t.priority}
                      </span>
                      {t.turnaroundSeconds != null ? (
                        <span className="text-[10px] mono" style={{ color: C.slateLight }}>
                          ⏱ {formatDuration(t.turnaroundSeconds)}
                        </span>
                      ) : (
                        <span className="text-[10px]" style={{ color: C.coral }}>
                          awaiting reply
                        </span>
                      )}
                      {t.resolutionSeconds != null && (
                        <span className="text-[10px] mono" style={{ color: C.slateLight }}>
                          ✓ {formatDuration(t.resolutionSeconds)}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Chat panel */}
        {selected ? (
          <div className="flex-1 flex flex-col min-h-0" style={{ background: C.paper }}>
            <div
              style={{ borderBottom: `1px solid ${C.line}`, background: C.card }}
              className="px-5 py-3 flex items-center justify-between flex-wrap gap-2"
            >
              <div>
                <div className="text-sm font-semibold flex items-center gap-2">
                  {selected.student_name || "Unknown"}
                  <span
                    style={{ background: STATUS[selected.status].tint, color: STATUS[selected.status].color }}
                    className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                  >
                    {STATUS[selected.status].label}
                  </span>
                </div>
                <div className="text-xs mono mt-0.5" style={{ color: C.slateLight }}>
                  {selected.student_phone} · {selected.ticket_no}
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-thin px-5 py-4 space-y-3">
              {(selected.messages || []).map((m) => {
                const fromAgent = m.direction === "outbound";
                const type = m.message_type || "text";
                return (
                  <div key={m.id} className={`flex ${fromAgent ? "justify-end" : "justify-start"}`}>
                    <div
                      style={{
                        background: fromAgent ? C.green : C.card,
                        color: fromAgent ? "#fff" : C.ink,
                        border: fromAgent ? "none" : `1px solid ${C.line}`,
                      }}
                      className="max-w-[70%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed shadow-sm"
                    >
                      {type === "text" && m.body}

                      {(type === "image" || type === "sticker") &&
                        (m.media_url ? (
                          <img src={m.media_url} alt="" className="rounded-lg max-w-[240px]" />
                        ) : (
                          <div className="text-xs italic opacity-80">📷 Sent: {m.filename || type}</div>
                        ))}

                      {type === "video" &&
                        (m.media_url ? (
                          <video controls src={m.media_url} className="rounded-lg max-w-[240px]" />
                        ) : (
                          <div className="text-xs italic opacity-80">🎞️ Sent: {m.filename || "video"}</div>
                        ))}

                      {(type === "audio" || type === "voice") &&
                        (m.media_url ? (
                          <audio controls src={m.media_url} />
                        ) : (
                          <div className="text-xs italic opacity-80">🎤 Sent: {m.filename || "voice note"}</div>
                        ))}

                      {type === "document" &&
                        (m.media_url ? (
                          <a
                            href={m.media_url}
                            target="_blank"
                            rel="noreferrer"
                            className="underline text-sm"
                            style={{ color: fromAgent ? "#fff" : C.ink }}
                          >
                            📄 {m.filename || "Document"}
                          </a>
                        ) : (
                          <div className="text-xs italic opacity-80">📄 Sent: {m.filename || "document"}</div>
                        ))}

                      {type !== "text" && m.caption && <div className="text-xs mt-1">{m.caption}</div>}

                      <div
                        style={{ color: fromAgent ? "rgba(255,255,255,0.75)" : C.slateLight }}
                        className="text-[10px] mt-1 mono"
                      >
                        {timeAgo(new Date(m.created_at).getTime())}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={threadEndRef} />
            </div>

            <div
              style={{ borderTop: `1px solid ${C.line}`, background: C.card }}
              className="p-3 flex gap-2 items-center relative"
            >
              {showEmojiPicker && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowEmojiPicker(false)} />
                  <div className="absolute bottom-full left-3 mb-2 z-50">
                    <EmojiPicker
                      onEmojiClick={(emojiData) => setDraft((prev) => prev + emojiData.emoji)}
                    />
                  </div>
                </>
              )}

              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileSelected}
                accept="image/*,application/pdf,.doc,.docx"
                className="hidden"
              />

              <button
                type="button"
                onClick={() => setShowEmojiPicker((v) => !v)}
                title="Emoji"
                style={{ color: C.slate }}
                className="w-9 h-9 flex-shrink-0 rounded-lg flex items-center justify-center hover:bg-black/5 transition-colors"
              >
                <Smile size={18} />
              </button>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={sending || recording}
                title="Attach file"
                style={{ color: C.slate }}
                className="w-9 h-9 flex-shrink-0 rounded-lg flex items-center justify-center hover:bg-black/5 transition-colors"
              >
                <Paperclip size={18} />
              </button>

              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSend()}
                placeholder="Type a reply…"
                disabled={sending}
                style={{ background: C.paperDim, color: C.ink }}
                className="flex-1 text-sm rounded-lg px-3.5 py-2.5 outline-none placeholder:text-slate-400"
              />

              <button
                type="button"
                onMouseDown={startRecording}
                onMouseUp={stopRecording}
                onMouseLeave={() => recording && stopRecording()}
                disabled={sending}
                title={recording ? "Recording… release to send" : "Hold to record a voice note"}
                style={{ background: recording ? C.coral : C.paperDim, color: recording ? "#fff" : C.slate }}
                className="w-9 h-9 flex-shrink-0 rounded-lg flex items-center justify-center transition-colors"
              >
                <Mic size={16} />
              </button>

              <button
                onClick={handleSend}
                disabled={sending}
                style={{ background: C.green, opacity: sending ? 0.6 : 1 }}
                className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 hover:opacity-90 transition-opacity"
              >
                <Send size={16} color="#fff" />
              </button>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm" style={{ color: C.slateLight }}>
            {loading ? "Loading…" : "Select a ticket to view the conversation."}
          </div>
        )}

        {/* Details panel */}
        {selected && (
          <div
            style={{ borderLeft: `1px solid ${C.line}`, background: C.card, width: 300 }}
            className="flex-shrink-0 overflow-y-auto scrollbar-thin p-5 space-y-5"
          >
            <div>
              <div className="text-[10px] uppercase tracking-wide font-medium mb-1" style={{ color: C.slateLight }}>
                Ticket
              </div>
              <div className="mono text-sm font-medium">{selected.ticket_no}</div>
            </div>

            <div className="flex items-center gap-2 text-xs" style={{ color: C.slate }}>
              <Calendar size={13} /> First contact {formatDate(selected.created_at)}
            </div>
            <div className="flex items-center gap-2 text-xs" style={{ color: C.slate }}>
              <Phone size={13} /> <span className="mono">{selected.student_phone}</span>
            </div>

            {selected.turnaroundTime?.status === "awaiting_reply" && (
              <div className="text-xs" style={{ color: C.coral }}>
                Waiting {formatDuration(selected.turnaroundTime.waitingSeconds)} for first reply
              </div>
            )}
            {selected.turnaroundTime?.status === "replied" && (
              <div className="text-xs" style={{ color: C.slate }}>
                Turnaround time: {formatDuration(selected.turnaroundTime.turnaroundSeconds)}
              </div>
            )}
            {selected.resolutionSeconds != null && (
              <div className="text-xs" style={{ color: C.slate }}>
                Resolved in {formatDuration(selected.resolutionSeconds)}
              </div>
            )}

            <div>
              <div className="text-[10px] uppercase tracking-wide font-medium mb-1.5" style={{ color: C.slateLight }}>
                Status
              </div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(STATUS).map(([key, meta]) => (
                  <button
                    key={key}
                    onClick={() => updateTicket(selected.id, { status: key })}
                    disabled={key === "closed"}
                    style={{
                      background: selected.status === key ? meta.color : C.paperDim,
                      color: selected.status === key ? "#fff" : C.slate,
                      opacity: key === "closed" ? 0.5 : 1,
                      cursor: key === "closed" ? "not-allowed" : "pointer",
                    }}
                    className="text-xs px-2.5 py-1 rounded-full font-medium capitalize"
                  >
                    {meta.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="text-[10px] uppercase tracking-wide font-medium mb-1.5" style={{ color: C.slateLight }}>
                Priority
              </div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(PRIORITY).map(([key, meta]) => (
                  <button
                    key={key}
                    onClick={() => updateTicket(selected.id, { priority: key })}
                    style={{
                      background: selected.priority === key ? meta.color : C.paperDim,
                      color: selected.priority === key ? "#fff" : C.slate,
                    }}
                    className="text-xs px-2.5 py-1 rounded-full font-medium"
                  >
                    {meta.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="text-[10px] uppercase tracking-wide font-medium mb-1.5" style={{ color: C.slateLight }}>
                Category
              </div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(CATEGORY).map(([key, meta]) => (
                  <button
                    key={key}
                    onClick={() => updateTicket(selected.id, { category: key })}
                    style={{
                      background: selected.category === key ? meta.color : C.paperDim,
                      color: selected.category === key ? "#fff" : C.slate,
                    }}
                    className="text-xs px-2.5 py-1 rounded-full font-medium"
                  >
                    {meta.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="text-[10px] uppercase tracking-wide font-medium mb-1.5" style={{ color: C.slateLight }}>
                Assignee
              </div>
              <div className="text-sm">{selected.assignee || "Unassigned"}</div>
            </div>

            <div>
              <div className="text-[10px] uppercase tracking-wide font-medium mb-1.5" style={{ color: C.slateLight }}>
                Tags
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(selected.tags || []).length === 0 && (
                  <span className="text-xs" style={{ color: C.slateLight }}>None</span>
                )}
                {(selected.tags || []).map((tag) => (
                  <span
                    key={tag}
                    style={{ background: C.paperDim, color: C.slate }}
                    className="text-[10px] px-2 py-1 rounded flex items-center gap-1"
                  >
                    <TagIcon size={10} /> {tag}
                  </span>
                ))}
              </div>
            </div>

            <div>
              <div className="text-[10px] uppercase tracking-wide font-medium mb-1.5" style={{ color: C.slateLight }}>
                Internal notes
              </div>
              <textarea
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
                onBlur={saveNotesIfChanged}
                placeholder="Add a note for the team…"
                style={{ background: C.paperDim, color: C.ink, minHeight: 70 }}
                className="w-full text-xs rounded-lg p-2.5 outline-none resize-none placeholder:text-slate-400"
              />
            </div>

            <div style={{ borderTop: `1px solid ${C.line}` }} className="pt-4 space-y-2">
              <button
                onClick={() => handleMarkResolved(selected)}
                disabled={selected.status === "resolved" || selected.status === "closed"}
                style={{
                  background: selected.status === "resolved" || selected.status === "closed" ? C.paperDim : C.greenTint,
                  color: selected.status === "resolved" || selected.status === "closed" ? C.slateLight : C.greenDark,
                  cursor: selected.status === "resolved" || selected.status === "closed" ? "not-allowed" : "pointer",
                }}
                className="w-full text-sm font-medium py-2.5 rounded-lg flex items-center justify-center gap-2"
              >
                <CheckCircle2 size={15} /> Mark as resolved
              </button>

              <button
                onClick={() => handleClose(selected)}
                disabled={selected.status !== "resolved"}
                style={{
                  background: selected.status === "resolved" ? C.ink : C.paperDim,
                  color: selected.status === "resolved" ? "#fff" : C.slateLight,
                  cursor: selected.status === "resolved" ? "pointer" : "not-allowed",
                }}
                className="w-full text-sm font-medium py-2.5 rounded-lg flex items-center justify-center gap-2 transition-colors"
              >
                {selected.status === "resolved" ? <Unlock size={14} /> : <Lock size={14} />}
                Close ticket
              </button>
              {selected.status !== "resolved" && selected.status !== "closed" && (
                <div className="text-[10px] text-center flex items-center justify-center gap-1" style={{ color: C.slateLight }}>
                  <Lock size={10} /> Locked until the query is resolved
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          style={{ background: C.ink, color: "#fff" }}
          className="fixed bottom-5 right-5 px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 text-sm max-w-sm z-50"
        >
          <Clock size={15} color={C.amber} className="flex-shrink-0" />
          <span className="flex-1">{toast}</span>
          <button onClick={() => setToast(null)}>
            <X size={14} color={C.slateLight} />
          </button>
        </div>
      )}
    </div>
  );
}
