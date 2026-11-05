"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Upload, UserPlus } from "lucide-react";
import { Badge, Button, Card, CardHeader, Input, Label, Select, Textarea } from "./ui";
import { postJSON } from "./action-button";

export interface EmployeeRow {
  id: string;
  employeeCode: string;
  fullName: string;
  email: string;
  departmentCode: string;
  jobTitle: string;
  grade: string;
  managerCode: string | null;
  budgetLimitSar: number;
  preferredAirline: string | null;
  preferredDeparture: string;
  earliestDeparture: string | null;
  baggage: string;
  seatPreference: string;
  homeAirport: string;
  specialRequirements: string | null;
}

const BLANK: Omit<EmployeeRow, "id"> = {
  employeeCode: "", fullName: "", email: "", departmentCode: "CONS", jobTitle: "", grade: "STANDARD", managerCode: "",
  budgetLimitSar: 1200, preferredAirline: "", preferredDeparture: "ANY", earliestDeparture: "", baggage: "CABIN",
  seatPreference: "ANY", homeAirport: "RUH", specialRequirements: "",
};

export function EmployeeEditor({ departments, employee, onClose }: { departments: { code: string; name: string }[]; employee?: EmployeeRow; onClose: () => void }) {
  const router = useRouter();
  const [v, setV] = useState<Omit<EmployeeRow, "id">>(employee ?? BLANK);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const f = (k: keyof typeof v, label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <div>
      <Label>{label}</Label>
      <Input value={(v[k] ?? "") as string | number} onChange={(e) => setV({ ...v, [k]: props.type === "number" ? parseInt(e.target.value || "0", 10) : e.target.value })} {...props} />
    </div>
  );
  const s = (k: keyof typeof v, label: string, opts: [string, string][]) => (
    <div>
      <Label>{label}</Label>
      <Select value={(v[k] ?? "") as string} onChange={(e) => setV({ ...v, [k]: e.target.value })}>
        {opts.map(([val, l]) => <option key={val} value={val}>{l}</option>)}
      </Select>
    </div>
  );
  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await postJSON(employee ? `/api/employees/${employee.id}` : "/api/employees", v, employee ? "PATCH" : "POST");
      router.refresh();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="mb-4">
      <CardHeader title={employee ? `Edit ${employee.fullName}` : "Add employee"} action={<Button size="sm" variant="ghost" onClick={onClose}>Close</Button>} />
      <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
        {f("employeeCode", "Employee ID")}
        {f("fullName", "Full name")}
        {f("email", "Email", { type: "email" })}
        {f("jobTitle", "Job title")}
        {s("departmentCode", "Department", departments.map((d) => [d.code, d.name]))}
        {s("grade", "Grade", [["STANDARD", "Standard"], ["SENIOR", "Senior manager"], ["EXECUTIVE", "Executive"]])}
        {f("managerCode", "Manager (employee ID)")}
        {f("budgetLimitSar", "Travel budget limit (SAR)", { type: "number" })}
        {f("preferredAirline", "Preferred airline (IATA)")}
        {s("preferredDeparture", "Preferred departure", [["ANY", "Any"], ["EARLY", "Early (before 7)"], ["MORNING", "Morning"], ["AFTERNOON", "Afternoon"], ["EVENING", "Evening"]])}
        {f("earliestDeparture", "Earliest departure (hard)", { type: "time" })}
        {s("baggage", "Baggage", [["CABIN", "Cabin bag"], ["CHECKED", "Checked bag required"]])}
        {s("seatPreference", "Seat", [["ANY", "Any"], ["AISLE", "Aisle"], ["WINDOW", "Window"]])}
        {f("homeAirport", "Home airport")}
        <div className="sm:col-span-2">{f("specialRequirements", "Special travel requirements")}</div>
      </div>
      <div className="flex items-center gap-3 border-t border-line px-5 py-3">
        <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save employee"}</Button>
        {err && <span className="text-xs text-danger">{err}</span>}
      </div>
    </Card>
  );
}

interface ImportResult { results: { row: number; code?: string; ok: boolean; errors: string[] }[]; validCount: number; errorCount: number; imported: number }

export function CsvImport({ template, onClose }: { template: string; onClose: () => void }) {
  const router = useRouter();
  const [csv, setCsv] = useState(template);
  const [res, setRes] = useState<ImportResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(commit: boolean) {
    setBusy(true);
    setErr(null);
    try {
      const r = await postJSON<ImportResult>("/api/employees/import", { csv, commit });
      setRes(r);
      if (commit && r.imported) router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="mb-4">
      <CardHeader title="Import employees from CSV" subtitle="Validate first; import runs only if every row is valid (all-or-nothing)." action={<Button size="sm" variant="ghost" onClick={onClose}>Close</Button>} />
      <div className="space-y-3 p-5">
        <input
          type="file"
          accept=".csv,text/csv"
          className="text-xs"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (file) setCsv(await file.text());
          }}
        />
        <Textarea rows={6} className="font-mono text-xs" value={csv} onChange={(e) => setCsv(e.target.value)} />
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => run(false)} disabled={busy}>Validate</Button>
          <Button onClick={() => run(true)} disabled={busy || !res || res.errorCount > 0 || res.validCount === 0}>Import {res?.validCount ?? 0} employee(s)</Button>
        </div>
        {err && <p className="text-xs text-danger">{err}</p>}
        {res && (
          <div className="rounded-md border border-line text-xs">
            {res.imported > 0 && <div className="border-b border-line bg-accent-soft px-3 py-2 text-accent">Imported {res.imported} employee(s).</div>}
            {res.results.map((r) => (
              <div key={r.row} className="flex gap-3 border-b border-line px-3 py-1.5 last:border-0">
                <span className="tabular w-12 text-muted">Row {r.row}</span>
                <span className="w-20 font-medium">{r.code ?? "—"}</span>
                {r.ok ? <Badge tone="green">valid</Badge> : <span className="text-danger">{r.errors.join("; ")}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

export function EmployeeToolbar({ departments, template, editing }: { departments: { code: string; name: string }[]; template: string; editing?: EmployeeRow }) {
  const [mode, setMode] = useState<"none" | "add" | "import">("none");
  const router = useRouter();
  return (
    <>
      <div className="mb-4 flex gap-2">
        <Button onClick={() => setMode("add")}><UserPlus className="h-4 w-4" /> Add employee</Button>
        <Button variant="secondary" onClick={() => setMode("import")}><Upload className="h-4 w-4" /> Import CSV</Button>
      </div>
      {mode === "add" && <EmployeeEditor departments={departments} onClose={() => setMode("none")} />}
      {mode === "import" && <CsvImport template={template} onClose={() => setMode("none")} />}
      {editing && <EmployeeEditor key={editing.id} departments={departments} employee={editing} onClose={() => router.push("/employees")} />}
    </>
  );
}
