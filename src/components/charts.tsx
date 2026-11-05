"use client";

import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const NAVY = "#172645";
const ACCENT = "#0f9d6b";
const GRID = "#eceff4";
const fmt = (minor: number) => `SAR ${Math.round(minor / 100).toLocaleString("en")}`;
const short = (minor: number) => {
  const v = minor / 100;
  return v >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v));
};

const tooltipStyle = { fontSize: 12, borderRadius: 6, border: "1px solid #e5e8ef", boxShadow: "none" };

export function MonthlySpendChart({ data }: { data: { label: string; spendMinor: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} stroke="#64748b" />
        <YAxis tickFormatter={short} tickLine={false} axisLine={false} fontSize={12} stroke="#64748b" />
        <Tooltip formatter={(v: number) => fmt(v)} contentStyle={tooltipStyle} cursor={{ fill: "#f6f7f9" }} />
        <Bar dataKey="spendMinor" name="Spend" fill={NAVY} radius={[3, 3, 0, 0]} maxBarSize={36} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function HorizontalBars({ data, color = NAVY }: { data: { name: string; spendMinor: number }[]; color?: string }) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(140, data.length * 36)}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
        <CartesianGrid horizontal={false} stroke={GRID} />
        <XAxis type="number" tickFormatter={short} tickLine={false} axisLine={false} fontSize={11} stroke="#64748b" />
        <YAxis type="category" dataKey="name" width={130} tickLine={false} axisLine={false} fontSize={12} stroke="#334155" />
        <Tooltip formatter={(v: number) => fmt(v)} contentStyle={tooltipStyle} cursor={{ fill: "#f6f7f9" }} />
        <Bar dataKey="spendMinor" name="Spend" fill={color} radius={[0, 3, 3, 0]} maxBarSize={18} />
      </BarChart>
    </ResponsiveContainer>
  );
}

const COMPLIANCE_COLORS: Record<string, string> = { COMPLIANT: ACCENT, REQUIRES_APPROVAL: "#d69e2e", POLICY_VIOLATION: "#c53030" };
const COMPLIANCE_LABEL: Record<string, string> = { COMPLIANT: "Compliant", REQUIRES_APPROVAL: "Approved exception", POLICY_VIOLATION: "Violation" };

export function ComplianceDonut({ data }: { data: { status: string; count: number }[] }) {
  const total = data.reduce((a, d) => a + d.count, 0);
  const compliant = data.find((d) => d.status === "COMPLIANT")?.count ?? 0;
  return (
    <div className="flex items-center gap-6">
      <div className="relative h-[150px] w-[150px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data.filter((d) => d.count > 0)} dataKey="count" nameKey="status" innerRadius={48} outerRadius={70} strokeWidth={2}>
              {data.filter((d) => d.count > 0).map((d) => (
                <Cell key={d.status} fill={COMPLIANCE_COLORS[d.status]} />
              ))}
            </Pie>
            <Tooltip formatter={(v: number, n: string) => [v, COMPLIANCE_LABEL[n] ?? n]} contentStyle={tooltipStyle} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <div className="tabular text-xl font-semibold">{total ? Math.round((compliant * 100) / total) : 0}%</div>
          <div className="text-[10px] uppercase tracking-wide text-muted">compliant</div>
        </div>
      </div>
      <ul className="space-y-2 text-sm">
        {data.map((d) => (
          <li key={d.status} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: COMPLIANCE_COLORS[d.status] }} />
            <span className="text-muted">{COMPLIANCE_LABEL[d.status]}</span>
            <span className="tabular ml-auto pl-4 font-medium">{d.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function BudgetBars({ data }: { data: { name: string; spendMinor: number; budgetMinor: number; utilisationPct: number }[] }) {
  return (
    <ul className="space-y-3">
      {data.map((d) => (
        <li key={d.name}>
          <div className="mb-1 flex justify-between text-xs">
            <span className="font-medium text-ink">{d.name}</span>
            <span className="tabular text-muted">
              {fmt(d.spendMinor)} / {fmt(d.budgetMinor)} · {d.utilisationPct}%
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-canvas">
            <div
              className="h-full rounded-full"
              style={{ width: `${Math.min(100, d.utilisationPct)}%`, background: d.utilisationPct > 90 ? "#c53030" : d.utilisationPct > 70 ? "#d69e2e" : ACCENT }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
