import { useState, useEffect } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import { Clock, CheckCircle2, Inbox, TrendingUp, Users } from "lucide-react";
import { C, STATUS, PRIORITY, CATEGORY, formatDuration, api } from "./threadline-crm.jsx";

const RANGES = [
  { key: "7d", days: 7, label: "7 days" },
  { key: "14d", days: 14, label: "14 days" },
  { key: "30d", days: 30, label: "30 days" },
];

const PRIORITY_ORDER = ["low", "medium", "high", "urgent"];

function formatDay(iso) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function KpiCard({ icon: Icon, label, value, sub, accent }) {
  return (
    <div
      style={{ background: C.card, border: `1px solid ${C.line}` }}
      className="rounded-xl p-4 flex-1 min-w-[150px]"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] uppercase tracking-wide font-medium" style={{ color: C.slateLight }}>
          {label}
        </span>
        <Icon size={15} color={accent || C.slateLight} />
      </div>
      <div className="display text-2xl font-semibold" style={{ color: C.ink }}>
        {value}
      </div>
      {sub && (
        <div className="text-xs mt-1" style={{ color: C.slate }}>
          {sub}
        </div>
      )}
    </div>
  );
}

export default function AnalyticsView({ onUnauthorized }) {
  const [range, setRange] = useState("14d");
  const [data, setData] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    const days = RANGES.find((r) => r.key === range)?.days || 14;
    let cancelled = false;

    setError(null);
    api(`/api/analytics/summary?days=${days}`)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err.unauthorized) return onUnauthorized?.();
        setError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, [range]);

  useEffect(() => {
    let cancelled = false;
    api("/api/tickets")
      .then((res) => {
        if (!cancelled) setTickets(res);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err.unauthorized) return onUnauthorized?.();
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="p-6 text-sm" style={{ color: C.coral }}>
        Couldn't load analytics: {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-6 text-sm" style={{ color: C.slateLight }}>
        Loading analytics…
      </div>
    );
  }

  const openNow = data.byStatus
    .filter((s) => ["new", "open", "pending"].includes(s.status))
    .reduce((sum, s) => sum + s.count, 0);
  const resolvedTotal = data.byStatus
    .filter((s) => ["resolved", "closed"].includes(s.status))
    .reduce((sum, s) => sum + s.count, 0);

  const volumeData = data.volume.map((v) => ({
    date: formatDay(v.date),
    created: v.created,
    resolved: v.resolved,
  }));

  const categoryData = data.byCategory
    .map((c) => ({
      key: c.category,
      label: CATEGORY[c.category]?.label || c.category,
      color: CATEGORY[c.category]?.color || C.slateLight,
      count: c.count,
    }))
    .sort((a, b) => b.count - a.count);
  const maxCategoryCount = categoryData[0]?.count || 1;

  const statusData = data.byStatus.map((s) => ({
    key: s.status,
    label: STATUS[s.status]?.label || s.status,
    color: STATUS[s.status]?.color || C.slateLight,
    count: s.count,
  }));

  const priorityData = PRIORITY_ORDER.map((key) => ({
    key,
    label: PRIORITY[key]?.label || key,
    color: PRIORITY[key]?.color || C.slateLight,
    count: data.byPriority.find((p) => p.priority === key)?.count || 0,
  }));
  const maxPriorityCount = Math.max(1, ...priorityData.map((p) => p.count));

  return (
    <div
      style={{ fontFamily: "'Inter', sans-serif", background: C.paper, color: C.ink }}
      className="w-full min-h-full p-6"
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Space+Grotesk:wght@500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
        .display { font-family: 'Space Grotesk', sans-serif; }
        .mono { font-family: 'JetBrains Mono', monospace; }
      `}</style>

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div>
          <h1 className="display text-xl font-semibold">Analytics</h1>
          <p className="text-xs mt-0.5" style={{ color: C.slateLight }}>
            Launchpad Support Line · Whapi connected
          </p>
        </div>
        <div className="flex gap-1.5">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              style={{
                background: range === r.key ? C.ink : C.paperDim,
                color: range === r.key ? "#fff" : C.slate,
              }}
              className="text-xs px-3 py-1.5 rounded-full font-medium transition-colors"
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI row */}
      <div className="flex flex-wrap gap-3 mb-6">
        <KpiCard
          icon={Inbox}
          label="Total Tickets"
          value={data.totalTickets}
          sub={`last ${data.rangeDays} days`}
          accent={C.ink}
        />
        <KpiCard
          icon={TrendingUp}
          label="Currently Open"
          value={openNow}
          sub="new + open + pending"
          accent={C.coral}
        />
        <KpiCard
          icon={Clock}
          label="Avg Turnaround Time"
          value={data.avgTurnaroundSeconds != null ? formatDuration(data.avgTurnaroundSeconds) : "—"}
          sub="ticket opened → first reply"
          accent={C.amber}
        />
        <KpiCard
          icon={CheckCircle2}
          label="Avg Resolution Time"
          value={data.avgResolutionSeconds != null ? formatDuration(data.avgResolutionSeconds) : "—"}
          sub="created → resolved"
          accent={C.green}
        />
        <KpiCard
          icon={Users}
          label="Resolution Rate"
          value={data.resolutionRate != null ? `${data.resolutionRate}%` : "—"}
          sub={`${resolvedTotal} of ${data.totalTickets} tickets`}
          accent={C.greenDark}
        />
      </div>

      {/* Volume chart */}
      <div style={{ background: C.card, border: `1px solid ${C.line}` }} className="rounded-xl p-4 mb-5">
        <div className="text-sm font-medium mb-3">Ticket volume — created vs resolved</div>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={volumeData} barGap={2}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.line} vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: C.slateLight }} axisLine={{ stroke: C.line }} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: C.slateLight }} axisLine={false} tickLine={false} width={24} />
            <Tooltip
              contentStyle={{ background: C.ink, border: "none", borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: "#fff" }}
              itemStyle={{ color: "#fff" }}
            />
            <Bar dataKey="created" fill={C.coral} radius={[3, 3, 0, 0]} name="Created" />
            <Bar dataKey="resolved" fill={C.green} radius={[3, 3, 0, 0]} name="Resolved" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
        {/* Category breakdown */}
        <div style={{ background: C.card, border: `1px solid ${C.line}` }} className="rounded-xl p-4">
          <div className="text-sm font-medium mb-3">Tickets by category</div>
          {categoryData.length === 0 ? (
            <div className="text-xs" style={{ color: C.slateLight }}>No tickets in this range.</div>
          ) : (
            <div className="space-y-2.5">
              {categoryData.map((c) => (
                <div key={c.key}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span style={{ color: C.slate }}>{c.label}</span>
                    <span className="mono" style={{ color: C.slateLight }}>{c.count}</span>
                  </div>
                  <div style={{ background: C.paperDim }} className="h-2 rounded-full overflow-hidden">
                    <div
                      style={{ width: `${(c.count / maxCategoryCount) * 100}%`, background: c.color }}
                      className="h-full rounded-full"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Status breakdown */}
        <div style={{ background: C.card, border: `1px solid ${C.line}` }} className="rounded-xl p-4">
          <div className="text-sm font-medium mb-3">Tickets by status</div>
          {statusData.length === 0 ? (
            <div className="text-xs" style={{ color: C.slateLight }}>No tickets in this range.</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={statusData} dataKey="count" nameKey="label" innerRadius={50} outerRadius={78} paddingAngle={2}>
                  {statusData.map((s) => (
                    <Cell key={s.key} fill={s.color} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ background: C.ink, border: "none", borderRadius: 8, fontSize: 12 }} itemStyle={{ color: "#fff" }} />
                <Legend
                  verticalAlign="middle"
                  align="right"
                  layout="vertical"
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ fontSize: 12, color: C.slate }}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Priority breakdown */}
        <div style={{ background: C.card, border: `1px solid ${C.line}` }} className="rounded-xl p-4">
          <div className="text-sm font-medium mb-3">Tickets by priority</div>
          <div className="flex items-end gap-4 h-32 px-2">
            {priorityData.map((p) => (
              <div key={p.key} className="flex-1 flex flex-col items-center gap-2">
                <div
                  style={{ height: `${(p.count / maxPriorityCount) * 100}%`, background: p.color, minHeight: 4 }}
                  className="w-full rounded-t-md"
                />
                <div className="text-center">
                  <div className="mono text-xs font-medium">{p.count}</div>
                  <div className="text-[10px]" style={{ color: C.slateLight }}>{p.label}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Agent performance */}
        <div style={{ background: C.card, border: `1px solid ${C.line}` }} className="rounded-xl p-4">
          <div className="text-sm font-medium mb-3">Agent performance</div>
          <table className="w-full text-xs">
            <thead>
              <tr style={{ color: C.slateLight }} className="text-left border-b">
                <th className="pb-2 font-medium" style={{ borderColor: C.line }}>Agent</th>
                <th className="pb-2 font-medium">Handled</th>
                <th className="pb-2 font-medium">Avg resolution</th>
                <th className="pb-2 font-medium">Resolution rate</th>
              </tr>
            </thead>
            <tbody>
              {data.byAgent.map((a) => (
                <tr key={a.agent} style={{ borderColor: C.line }} className="border-b last:border-0">
                  <td className="py-2.5 font-medium">{a.agent}</td>
                  <td className="py-2.5 mono">{a.handled}</td>
                  <td className="py-2.5 mono">
                    {a.avgResolutionSeconds != null ? formatDuration(a.avgResolutionSeconds) : "—"}
                  </td>
                  <td className="py-2.5 mono">{a.resolutionRate != null ? `${a.resolutionRate}%` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Per-ticket table */}
      <div style={{ background: C.card, border: `1px solid ${C.line}` }} className="rounded-xl p-4 mt-5">
        <div className="text-sm font-medium mb-3">All tickets</div>
        {tickets.length === 0 ? (
          <div className="text-xs" style={{ color: C.slateLight }}>No tickets yet.</div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr style={{ color: C.slateLight, borderColor: C.line }} className="text-left border-b">
                <th className="pb-2 font-medium">Ticket</th>
                <th className="pb-2 font-medium">Category</th>
                <th className="pb-2 font-medium">Priority</th>
                <th className="pb-2 font-medium">Status</th>
                <th className="pb-2 font-medium">Turnaround</th>
                <th className="pb-2 font-medium">Resolution</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <tr key={t.id} style={{ borderColor: C.line }} className="border-b last:border-0">
                  <td className="py-2 mono">{t.ticket_no}</td>
                  <td className="py-2" style={{ color: CATEGORY[t.category]?.color }}>
                    {CATEGORY[t.category]?.label || t.category}
                  </td>
                  <td className="py-2" style={{ color: PRIORITY[t.priority]?.color }}>
                    {PRIORITY[t.priority]?.label || t.priority}
                  </td>
                  <td className="py-2">{STATUS[t.status]?.label || t.status}</td>
                  <td className="py-2 mono">
                    {t.turnaroundSeconds != null ? formatDuration(t.turnaroundSeconds) : "—"}
                  </td>
                  <td className="py-2 mono">
                    {t.resolutionSeconds != null ? formatDuration(t.resolutionSeconds) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
