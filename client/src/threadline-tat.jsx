import { useState, useEffect } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Inbox, CheckCircle2, AlertTriangle, Clock, Hourglass, Download, CalendarOff, Trash2, X } from "lucide-react";
import { C, CATEGORY, PRIORITY, STATUS, api, formatDue } from "./threadline-crm.jsx";

const PERIODS = [
  { key: "day", label: "Daily" },
  { key: "week", label: "Weekly" },
  { key: "month", label: "Monthly" },
];

// Report table columns. Each count is clickable and drills into the tickets
// behind it (bucket.ids[key] from the API).
const COLUMNS = [
  { key: "received", label: "Received" },
  { key: "respondedWithinTat", label: "Responded within TAT", tone: "good" },
  { key: "responseBreached", label: "Response TAT breached", tone: "bad" },
  { key: "awaitingResponse", label: "Not yet responded" },
  { key: "resolvedWithinTat", label: "Resolved within TAT", tone: "good" },
  { key: "resolutionBreached", label: "Resolution TAT breached", tone: "bad" },
  { key: "unresolved", label: "Not yet resolved" },
  { key: "backlogAtClose", label: "Awaiting our reply at close", hint: "Queries with no reply from us yet (incl. earlier days) at 18:00 on the last working day — or now, for today" },
  { key: "afterHours", label: "Received after-hours" },
];

// Colors are stored by name and resolved at render time: this module is
// imported by threadline-crm.jsx, so C isn't initialized yet while this
// top-level code runs (reading C here crashed the whole app on load).
const RESPONSE_STATUS = {
  met: { label: "Within TAT", tone: "greenDark" },
  late: { label: "Breached (late)", tone: "coral" },
  overdue: { label: "Breached (no reply)", tone: "coral" },
  pending: { label: "Due soon", tone: "amber" },
};
const RESOLUTION_STATUS = {
  met: { label: "Within TAT", tone: "greenDark" },
  late: { label: "Breached (late)", tone: "coral" },
  overdue: { label: "Breached (unresolved)", tone: "coral" },
  pending: { label: "In progress", tone: "amber" },
};

const IST = { timeZone: "Asia/Kolkata" };
function formatIst(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-GB", { ...IST, day: "2-digit", month: "short" })} ${d.toLocaleTimeString("en-GB", {
    ...IST,
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}
function formatWorking(minutes) {
  if (minutes == null) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}
function bucketLabel(b, period) {
  const d = new Date(`${b.startKey}T00:00:00Z`);
  const opts = { timeZone: "UTC" };
  if (period === "month") return d.toLocaleDateString("en-GB", { ...opts, month: "short", year: "numeric" });
  if (period === "week") {
    const e = new Date(`${b.endKey}T00:00:00Z`);
    return `${d.toLocaleDateString("en-GB", { ...opts, day: "numeric", month: "short" })} – ${e.toLocaleDateString("en-GB", {
      ...opts,
      day: "numeric",
      month: "short",
    })}`;
  }
  return d.toLocaleDateString("en-GB", { ...opts, weekday: "short", day: "numeric", month: "short" });
}
const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : "—");

function downloadCsv(filename, header, rows) {
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [header, ...rows].map((r) => r.map(esc).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function Kpi({ icon: Icon, label, value, sub, accent }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.line}` }} className="rounded-xl p-4 flex-1 min-w-[150px]">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] uppercase tracking-wide font-medium" style={{ color: C.slateLight }}>
          {label}
        </span>
        <Icon size={15} color={accent} />
      </div>
      <div className="display text-2xl font-semibold" style={{ color: C.ink }}>
        {value}
      </div>
      {sub && <div className="text-xs mt-1" style={{ color: C.slate }}>{sub}</div>}
    </div>
  );
}

function HolidayManager({ holidays, onChanged, onError }) {
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const add = async (e) => {
    e.preventDefault();
    try {
      await api("/api/holidays", { method: "POST", body: JSON.stringify({ date, name }) });
      setDate("");
      setName("");
      onChanged();
    } catch (err) {
      onError(err);
    }
  };
  const remove = async (d) => {
    try {
      await api(`/api/holidays/${d}`, { method: "DELETE" });
      onChanged();
    } catch (err) {
      onError(err);
    }
  };
  return (
    <div style={{ background: C.card, border: `1px solid ${C.line}` }} className="rounded-xl p-4 mb-5">
      <div className="text-sm font-medium mb-1">Holidays</div>
      <div className="text-xs mb-3" style={{ color: C.slateLight }}>
        No TAT time counts on these dates. Sundays are always off and don't need adding. Changes apply to every report
        immediately, including past periods.
      </div>
      <form onSubmit={add} className="flex gap-2 flex-wrap mb-3">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          style={{ background: C.paperDim, color: C.ink }}
          className="text-xs rounded-lg px-2.5 py-1.5 outline-none"
        />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Diwali"
          style={{ background: C.paperDim, color: C.ink }}
          className="text-xs rounded-lg px-2.5 py-1.5 outline-none flex-1 min-w-[140px]"
        />
        <button
          type="submit"
          disabled={!date || !name.trim()}
          style={{ background: C.ink, color: "#fff", opacity: !date || !name.trim() ? 0.5 : 1 }}
          className="text-xs px-3 py-1.5 rounded-lg font-medium"
        >
          Add holiday
        </button>
      </form>
      {holidays.length === 0 ? (
        <div className="text-xs" style={{ color: C.slateLight }}>No holidays added yet.</div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {holidays.map((h) => (
            <span
              key={h.date}
              style={{ background: C.paperDim, color: C.slate }}
              className="text-xs px-2 py-1 rounded-full flex items-center gap-1.5"
            >
              <span className="mono">{h.date}</span> {h.name}
              <button onClick={() => remove(h.date)} title="Remove" className="hover:opacity-60">
                <Trash2 size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function TatReportView({ onUnauthorized, onViewTicket }) {
  const [period, setPeriod] = useState("day");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [chartMetric, setChartMetric] = useState("response");
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [drill, setDrill] = useState(null); // { bucketKey, column }
  const [showHolidays, setShowHolidays] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const handleError = (err) => (err.unauthorized ? onUnauthorized?.() : setError(err.message));

  useEffect(() => {
    let cancelled = false;
    const qs = new URLSearchParams({ period });
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    setError(null);
    api(`/api/analytics/tat?${qs}`)
      .then((res) => !cancelled && setData(res))
      .catch((err) => !cancelled && handleError(err));
    return () => {
      cancelled = true;
    };
  }, [period, from, to, reloadKey]);

  if (error) {
    return <div className="p-6 text-sm" style={{ tone: "coral" }}>Couldn't load TAT report: {error}</div>;
  }
  if (!data) {
    return <div className="p-6 text-sm" style={{ color: C.slateLight }}>Loading TAT report…</div>;
  }

  const ticketById = new Map(data.tickets.map((t) => [t.id, t]));
  const buckets = [...data.buckets].reverse(); // newest first in the table
  const { totals } = data;

  const chartData = data.buckets.map((b) => {
    const c = b.counts;
    return chartMetric === "response"
      ? {
          label: bucketLabel(b, data.period),
          within: c.respondedWithinTat,
          breached: c.responseBreached,
          open: c.received - c.respondedWithinTat - c.responseBreached,
        }
      : {
          label: bucketLabel(b, data.period),
          within: c.resolvedWithinTat,
          breached: c.resolutionBreached,
          open: c.received - c.resolvedWithinTat - c.resolutionBreached,
        };
  });

  const drillBucket = drill && data.buckets.find((b) => b.key === drill.bucketKey);
  const drillColumn = drill && COLUMNS.find((c) => c.key === drill.column);
  const drillTickets = drillBucket ? drillBucket.ids[drill.column].map((id) => ticketById.get(id)).filter(Boolean) : [];

  const exportReport = () =>
    downloadCsv(
      `tat-${data.period}-${data.fromKey}-to-${data.toKey}.csv`,
      ["Period", "From", "To", ...COLUMNS.map((c) => c.label)],
      buckets.map((b) => [bucketLabel(b, data.period), b.startKey, b.endKey, ...COLUMNS.map((c) => b.counts[c.key])])
    );

  const exportDrill = () =>
    downloadCsv(
      `tat-${drill.column}-${drillBucket.key}.csv`,
      [
        "Ticket", "Student", "Phone", "Category", "Priority", "Status", "Assignee", "Received (IST)", "After-hours",
        "Response due", "First response", "Response working time", "Response TAT",
        "Resolution due", "Resolved", "Resolution working time", "Resolution TAT", "Time in Pending (working)",
      ],
      drillTickets.map((t) => [
        t.ticketNo, t.studentName, t.studentPhone, t.category, t.priority, t.status, t.assignee,
        formatIst(t.tat.receivedAt), t.tat.afterHours ? "yes" : "no",
        formatIst(t.tat.responseDueAt), formatIst(t.tat.firstResponseAt), formatWorking(t.tat.responseWorkingMinutes),
        RESPONSE_STATUS[t.tat.responseStatus].label,
        formatIst(t.tat.resolutionDueAt), formatIst(t.tat.resolvedAt), formatWorking(t.tat.resolutionWorkingMinutes),
        RESOLUTION_STATUS[t.tat.resolutionStatus].label,
        t.pendingTime?.stints ? formatWorking(t.pendingTime.totalWorkingMinutes) : "",
      ])
    );

  const cfg = data.config;
  const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: C.paper, color: C.ink }} className="w-full min-h-full p-6">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Space+Grotesk:wght@500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
        .display { font-family: 'Space Grotesk', sans-serif; }
        .mono { font-family: 'JetBrains Mono', monospace; }
      `}</style>

      {/* Header + filters, one row */}
      <div className="flex items-start justify-between flex-wrap gap-3 mb-6">
        <div>
          <h1 className="display text-xl font-semibold">TAT Reports</h1>
          <p className="text-xs mt-0.5" style={{ color: C.slateLight }}>
            Response within {cfg.responseTatMinutes / 60} working hrs · Resolution within {cfg.resolutionTatMinutes / 60}{" "}
            working hrs · Working hours {hhmm(cfg.workStartMinute)}–{hhmm(cfg.workEndMinute)} IST, Mon–Sat, excl. holidays
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => {
                setPeriod(p.key);
                setDrill(null);
              }}
              style={{ background: period === p.key ? C.ink : C.paperDim, color: period === p.key ? "#fff" : C.slate }}
              className="text-xs px-3 py-1.5 rounded-full font-medium"
            >
              {p.label}
            </button>
          ))}
          <input
            type="date"
            value={from || data.fromKey}
            max={to || data.toKey}
            onChange={(e) => setFrom(e.target.value)}
            style={{ background: C.paperDim, color: C.slate }}
            className="text-xs rounded-lg px-2 py-1.5 outline-none"
            title="From (IST date)"
          />
          <span className="text-xs" style={{ color: C.slateLight }}>to</span>
          <input
            type="date"
            value={to || data.toKey}
            min={from || data.fromKey}
            onChange={(e) => setTo(e.target.value)}
            style={{ background: C.paperDim, color: C.slate }}
            className="text-xs rounded-lg px-2 py-1.5 outline-none"
            title="To (IST date)"
          />
          {(from || to) && (
            <button
              onClick={() => {
                setFrom("");
                setTo("");
              }}
              className="text-xs px-2 py-1.5"
              style={{ color: C.slate }}
            >
              Reset
            </button>
          )}
          <button
            onClick={() => setShowHolidays((s) => !s)}
            style={{ background: showHolidays ? C.ink : C.paperDim, color: showHolidays ? "#fff" : C.slate }}
            className="text-xs px-3 py-1.5 rounded-full font-medium flex items-center gap-1"
          >
            <CalendarOff size={12} /> Holidays ({cfg.holidays.length})
          </button>
        </div>
      </div>

      {showHolidays && (
        <HolidayManager holidays={cfg.holidays} onChanged={() => setReloadKey((k) => k + 1)} onError={handleError} />
      )}

      {/* KPIs for the whole range */}
      <div className="flex flex-wrap gap-3 mb-6">
        <Kpi icon={Inbox} label="Queries received" value={totals.received} sub={`${data.fromKey} → ${data.toKey}`} accent={C.ink} />
        <Kpi
          icon={CheckCircle2}
          label="Responded within TAT"
          value={totals.respondedWithinTat}
          sub={`${pct(totals.respondedWithinTat, totals.received)} of received`}
          accent={C.green}
        />
        <Kpi
          icon={AlertTriangle}
          label="Response TAT breached"
          value={totals.responseBreached}
          sub={`${pct(totals.responseBreached, totals.received)} · late or no reply`}
          accent={C.coral}
        />
        <Kpi
          icon={CheckCircle2}
          label="Resolved within TAT"
          value={totals.resolvedWithinTat}
          sub={`${pct(totals.resolvedWithinTat, totals.received)} of received`}
          accent={C.green}
        />
        <Kpi
          icon={AlertTriangle}
          label="Resolution TAT breached"
          value={totals.resolutionBreached}
          sub={`${pct(totals.resolutionBreached, totals.received)} · late or unresolved`}
          accent={C.coral}
        />
        <Kpi
          icon={Hourglass}
          label="Awaiting our reply"
          value={totals.awaitingResponse}
          sub={`not yet responded · ${totals.unresolved} not yet resolved`}
          accent={C.amber}
        />
      </div>

      {/* Chart */}
      <div style={{ background: C.card, border: `1px solid ${C.line}` }} className="rounded-xl p-4 mb-5">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="text-sm font-medium">
            {chartMetric === "response" ? "Response" : "Resolution"} TAT by {data.period === "day" ? "day" : data.period}{" "}
            received
          </div>
          <div className="flex gap-1.5">
            {[
              { key: "response", label: "Response" },
              { key: "resolution", label: "Resolution" },
            ].map((m) => (
              <button
                key={m.key}
                onClick={() => setChartMetric(m.key)}
                style={{ background: chartMetric === m.key ? C.ink : C.paperDim, color: chartMetric === m.key ? "#fff" : C.slate }}
                className="text-xs px-3 py-1 rounded-full font-medium"
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chartData} barCategoryGap="25%">
            <CartesianGrid strokeDasharray="3 3" stroke={C.line} vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: C.slateLight }} axisLine={{ stroke: C.line }} tickLine={false} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: C.slateLight }} axisLine={false} tickLine={false} width={28} />
            <Tooltip
              cursor={{ fill: C.paperDim }}
              contentStyle={{ background: C.ink, border: "none", borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: "#fff" }}
              itemStyle={{ color: "#fff" }}
            />
            <Legend iconType="square" iconSize={9} wrapperStyle={{ fontSize: 12, color: C.slate }} />
            {/* 2px card-colored stroke = the gap between stacked segments */}
            <Bar dataKey="within" stackId="s" name="Within TAT" fill={C.green} stroke={C.card} strokeWidth={2} />
            <Bar dataKey="breached" stackId="s" name="Breached" fill={C.coral} stroke={C.card} strokeWidth={2} />
            <Bar
              dataKey="open"
              stackId="s"
              name="Not yet due"
              fill={C.line}
              stroke={C.card}
              strokeWidth={2}
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Report table */}
      <div style={{ background: C.card, border: `1px solid ${C.line}` }} className="rounded-xl p-4 mb-5">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="text-sm font-medium">
            {PERIODS.find((p) => p.key === data.period).label} report{" "}
            <span className="text-xs font-normal" style={{ color: C.slateLight }}>
              · click any number to see the tickets
            </span>
          </div>
          <button
            onClick={exportReport}
            style={{ background: C.paperDim, color: C.slate }}
            className="text-xs px-2.5 py-1.5 rounded-lg flex items-center gap-1"
          >
            <Download size={12} /> CSV
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ color: C.slateLight, borderColor: C.line }} className="text-left border-b">
                <th className="pb-2 pr-3 font-medium">{data.period === "day" ? "Day" : data.period === "week" ? "Week" : "Month"}</th>
                {COLUMNS.map((c) => (
                  <th key={c.key} className="pb-2 pr-3 font-medium" title={c.hint}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {buckets.map((b) => (
                <tr key={b.key} style={{ borderColor: C.line }} className="border-b last:border-0">
                  <td className="py-2 pr-3 whitespace-nowrap font-medium">{bucketLabel(b, data.period)}</td>
                  {COLUMNS.map((c) => {
                    const n = b.counts[c.key];
                    const isBacklogNA = c.key === "backlogAtClose" && b.backlogAsOf == null;
                    const active = drill?.bucketKey === b.key && drill?.column === c.key;
                    return (
                      <td key={c.key} className="py-2 pr-3 mono">
                        {isBacklogNA ? (
                          <span style={{ color: C.slateLight }} title="No working day in this period (or it hasn't started)">
                            —
                          </span>
                        ) : n === 0 ? (
                          <span style={{ color: C.slateLight }}>0</span>
                        ) : (
                          <button
                            onClick={() => setDrill(active ? null : { bucketKey: b.key, column: c.key })}
                            className="underline underline-offset-2 hover:opacity-70 px-1 -mx-1 rounded"
                            style={{
                              color: c.tone === "bad" ? C.coral : c.tone === "good" ? C.greenDark : C.ink,
                              background: active ? C.paperDim : "transparent",
                              fontWeight: c.tone === "bad" ? 600 : 400,
                            }}
                          >
                            {n}
                          </button>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Drill-down */}
      {drill && drillBucket && (
        <div style={{ background: C.card, border: `1px solid ${C.ink}` }} className="rounded-xl p-4">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div className="text-sm font-medium">
              {drillColumn.label} · {bucketLabel(drillBucket, data.period)}{" "}
              <span className="mono text-xs" style={{ color: C.slateLight }}>
                ({drillTickets.length})
              </span>
              {drill.column === "backlogAtClose" && drillBucket.backlogAsOf && (
                <span className="text-xs font-normal" style={{ color: C.slateLight }}>
                  {" "}
                  · as of {formatIst(drillBucket.backlogAsOf)}
                </span>
              )}
            </div>
            <div className="flex gap-1.5">
              <button
                onClick={exportDrill}
                style={{ background: C.paperDim, color: C.slate }}
                className="text-xs px-2.5 py-1.5 rounded-lg flex items-center gap-1"
              >
                <Download size={12} /> CSV
              </button>
              <button onClick={() => setDrill(null)} style={{ color: C.slate }} className="p-1.5" title="Close">
                <X size={14} />
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ color: C.slateLight, borderColor: C.line }} className="text-left border-b">
                  {["Ticket", "Student", "Category", "Status", "Received (IST)", "Response due", "First response", "Response", "Resolution due", "Resolved", "Resolution", "Time in Pending"].map(
                    (h) => (
                      <th key={h} className="pb-2 pr-3 font-medium whitespace-nowrap">
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {drillTickets.map((t) => {
                  const rs = RESPONSE_STATUS[t.tat.responseStatus];
                  const ss = RESOLUTION_STATUS[t.tat.resolutionStatus];
                  return (
                    <tr key={t.id} style={{ borderColor: C.line }} className="border-b last:border-0">
                      <td className="py-2 pr-3 mono">
                        <button onClick={() => onViewTicket(t.id)} className="underline hover:opacity-70" style={{ color: C.ink }}>
                          {t.ticketNo}
                        </button>
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap">{t.studentName || t.studentPhone}</td>
                      <td className="py-2 pr-3 whitespace-nowrap" style={{ color: CATEGORY[t.category]?.color }}>
                        {CATEGORY[t.category]?.label || t.category}
                        {(t.priority === "urgent" || t.priority === "high") && (
                          <span style={{ color: PRIORITY[t.priority].color }}> · {PRIORITY[t.priority].label}</span>
                        )}
                      </td>
                      <td className="py-2 pr-3">{STATUS[t.status]?.label || t.status}</td>
                      <td className="py-2 pr-3 mono whitespace-nowrap">
                        {formatIst(t.tat.receivedAt)}
                        {t.tat.afterHours && (
                          <span
                            title={`After-hours — clock started ${formatIst(t.tat.clockStartAt)}`}
                            className="ml-1 inline-flex align-middle"
                          >
                            <Clock size={11} color={C.slate} />
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3 mono whitespace-nowrap">{formatIst(t.tat.responseDueAt)}</td>
                      <td className="py-2 pr-3 mono whitespace-nowrap">{formatIst(t.tat.firstResponseAt)}</td>
                      <td className="py-2 pr-3 whitespace-nowrap" style={{ color: C[rs.tone] }}>
                        {rs.label} <span className="mono" style={{ color: C.slateLight }}>{formatWorking(t.tat.responseWorkingMinutes)}</span>
                      </td>
                      <td className="py-2 pr-3 mono whitespace-nowrap">{formatIst(t.tat.resolutionDueAt)}</td>
                      <td className="py-2 pr-3 mono whitespace-nowrap">{formatIst(t.tat.resolvedAt)}</td>
                      <td className="py-2 pr-3 whitespace-nowrap" style={{ color: C[ss.tone] }}>
                        {ss.label} <span className="mono" style={{ color: C.slateLight }}>{formatWorking(t.tat.resolutionWorkingMinutes)}</span>
                      </td>
                      <td className="py-2 pr-3 mono whitespace-nowrap" style={{ color: t.status === "pending" ? C.amber : C.slate }}>
                        {t.pendingTime?.stints ? formatWorking(t.pendingTime.totalWorkingMinutes) : "—"}
                        {t.status === "pending" && " (ongoing)"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="text-[11px] mt-3" style={{ color: C.slateLight }}>
            Times in IST. Durations are working time only. <Clock size={10} className="inline" /> = received after-hours.
          </div>
        </div>
      )}
    </div>
  );
}

