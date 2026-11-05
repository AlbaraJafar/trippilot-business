"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button, Card, CardHeader, Input, Label, Select, Textarea, cn } from "./ui";
import { postJSON } from "./action-button";
import type { TravelRequirements } from "@/lib/domain/types";

export interface EmployeeOpt { id: string; name: string; code: string; department: string; departmentId: string; baggage: string; note: string | null }
export interface DeptOpt { id: string; name: string }

const AIRPORT_OPTS = [
  ["RUH", "Riyadh (RUH)"], ["JED", "Jeddah (JED)"], ["MED", "Madinah (MED)"], ["DMM", "Dammam (DMM)"],
  ["AHB", "Abha (AHB)"], ["TUU", "Tabuk (TUU)"], ["DXB", "Dubai (DXB)"],
];



const csv = (a: string[]) => a.join(", ");
const fromCsv = (s: string) => s.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);

export function RequestForm({
  initial,
  employees,
  departments,
  initialEmployeeIds = [],
  nlInstruction,
  parsedBy = "FORM",
  lockToEmployeeId,
  afterCreateQuery = "",
}: {
  initial: TravelRequirements;
  employees: EmployeeOpt[];
  departments: DeptOpt[];
  initialEmployeeIds?: string[];
  nlInstruction?: string;
  parsedBy?: "CLAUDE" | "DETERMINISTIC" | "FORM";
  lockToEmployeeId?: string;
  afterCreateQuery?: string;
}) {
  const router = useRouter();
  const [r, setR] = useState<TravelRequirements>(initial);
  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState<string[]>(lockToEmployeeId ? [lockToEmployeeId] : initialEmployeeIds);
  const [deptId, setDeptId] = useState(
    () => employees.find((e) => e.id === (lockToEmployeeId ?? initialEmployeeIds[0]))?.departmentId ?? departments[0]?.id ?? "",
  );
  const [outDates, setOutDates] = useState(csv(initial.outboundDates));
  const [retDates, setRetDates] = useState(csv(initial.returnDates));
  const [airlines, setAirlines] = useState(csv(initial.preferredAirlines));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof TravelRequirements>(k: K, v: TravelRequirements[K]) => setR((p) => ({ ...p, [k]: v }));
  const [filter, setFilter] = useState("");
  const visible = useMemo(() => employees.filter((e) => `${e.name} ${e.department} ${e.code}`.toLowerCase().includes(filter.toLowerCase())), [employees, filter]);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const requirements: TravelRequirements = {
        ...r,
        outboundDates: fromCsv(outDates),
        returnDates: fromCsv(retDates),
        preferredAirlines: fromCsv(airlines).map((x) => x.toUpperCase()),
        travelerCount: selected.length,
        mode: selected.length > 1 ? "GROUP" : "INDIVIDUAL",
        title: r.title || `${r.origin} → ${r.destination}`,
        purpose: r.purpose || "Business travel",
      };
      const res = await postJSON<{ id: string }>("/api/requests", { requirements, employeeIds: selected, departmentId: deptId, nlInstruction, parsedBy });
      router.push(`/requests/${res.id}${afterCreateQuery}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const steps = ["Trip", "Constraints", "Budget & preferences", lockToEmployeeId ? "Review" : "Travelers"];
  const time = (k: "arriveBy" | "earliestDeparture" | "returnDepartAfter" | "latestReturn", label: string, hint?: string) => (
    <div>
      <Label>{label}</Label>
      <Input type="time" value={r[k] ?? ""} onChange={(e) => set(k, e.target.value || null)} />
      {hint && <p className="mt-1 text-[11px] text-muted">{hint}</p>}
    </div>
  );

  return (
    <Card>
      <div className="grid grid-cols-2 border-b border-line sm:grid-cols-4">
        {steps.map((s, i) => (
          <button
            key={s}
            onClick={() => setStep(i)}
            className={cn(
              "truncate border-b-2 px-3 py-3 text-left text-xs font-medium",
              i === step ? "border-navy-900 text-ink" : "border-transparent text-muted hover:text-ink",
            )}
          >
            <span className="mr-1.5 tabular text-muted">{i + 1}</span>
            {s}
          </button>
        ))}
      </div>

      <div className="p-5">
        {step === 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label>Request title</Label>
              <Input value={r.title} onChange={(e) => set("title", e.target.value)} placeholder="Jeddah client workshop" />
            </div>
            <div className="sm:col-span-2">
              <Label>Business purpose</Label>
              <Textarea value={r.purpose} onChange={(e) => set("purpose", e.target.value)} placeholder="Two-day on-site workshop with client leadership" />
            </div>
            <div>
              <Label>Origin</Label>
              <Select value={r.origin} onChange={(e) => set("origin", e.target.value)}>
                {AIRPORT_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            </div>
            <div>
              <Label>Destination</Label>
              <Select value={r.destination} onChange={(e) => set("destination", e.target.value)}>
                {AIRPORT_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            </div>
            <div>
              <Label>Outbound date(s)</Label>
              <Input value={outDates} onChange={(e) => setOutDates(e.target.value)} placeholder="2027-03-15, 2027-03-14" />
              <p className="mt-1 text-[11px] text-muted">YYYY-MM-DD; separate multiple candidate dates with commas.</p>
            </div>
            <div>
              <Label>Return date(s)</Label>
              <Input value={retDates} onChange={(e) => setRetDates(e.target.value)} placeholder="2027-03-16 (leave empty for one-way)" />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={r.flexibleDates} onChange={(e) => set("flexibleDates", e.target.checked)} /> Flexible dates
            </label>
            <div>
              <Label>Department (cost centre)</Label>
              <Select value={deptId} onChange={(e) => setDeptId(e.target.value)}>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Select>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="grid gap-4 sm:grid-cols-2">
            {time("arriveBy", "Required arrival time (outbound)", "Hard constraint — later arrivals are rejected.")}
            {time("earliestDeparture", "Earliest permitted departure (outbound)")}
            {time("returnDepartAfter", "Return: depart after")}
            {time("latestReturn", "Latest permitted return (arrival home)")}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={r.directOnly} onChange={(e) => set("directOnly", e.target.checked)} /> Direct flights only
            </label>
            <div>
              <Label>Baggage requirement</Label>
              <Select value={r.baggage} onChange={(e) => set("baggage", e.target.value as TravelRequirements["baggage"])}>
                <option value="ANY">Per employee profile</option>
                <option value="CHECKED">Checked bag required for all</option>
                <option value="CABIN">Cabin bag is enough</option>
              </Select>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Maximum budget per employee (SAR)</Label>
              <Input type="number" min={1} value={r.maxPerEmployeeSar} onChange={(e) => set("maxPerEmployeeSar", parseInt(e.target.value || "0", 10))} />
            </div>
            <div>
              <Label>Total budget (SAR)</Label>
              <Input type="number" min={1} value={r.totalBudgetSar} onChange={(e) => set("totalBudgetSar", parseInt(e.target.value || "0", 10))} />
            </div>
            <div>
              <Label>Preferred airlines (IATA codes)</Label>
              <Input value={airlines} onChange={(e) => setAirlines(e.target.value)} placeholder="SV, XY, F3" />
            </div>
            <div>
              <Label>Optimization objective</Label>
              <Select value={r.objective} onChange={(e) => set("objective", e.target.value as TravelRequirements["objective"])}>
                <option value="BALANCED">Best overall balance</option>
                <option value="CHEAPEST">Cheapest itinerary</option>
                <option value="LOWEST_GROUP_COST">Lowest total group cost</option>
                <option value="BEST_TIMES">Best departure & return times</option>
                <option value="MOST_COMPLIANT">Highest policy compliance</option>
              </Select>
              <p className="mt-1 text-[11px] text-muted">TripPilot always generates cheapest, balanced and convenient plans for comparison.</p>
            </div>
          </div>
        )}

        {step === 3 && !lockToEmployeeId && (
          <div>
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <Input className="max-w-xs" placeholder="Filter employees…" value={filter} onChange={(e) => setFilter(e.target.value)} />
              <span className="text-xs text-muted">{selected.length} selected</span>
              <Button size="sm" variant="secondary" onClick={() => setSelected(visible.map((e) => e.id))}>Select shown</Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected([])}>Clear</Button>
            </div>
            <div className="grid max-h-80 gap-1.5 overflow-y-auto sm:grid-cols-2">
              {visible.map((e) => (
                <label key={e.id} className={cn("flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm", selected.includes(e.id) ? "border-navy-600 bg-navy-900/[0.03]" : "border-line")}>
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={selected.includes(e.id)}
                    onChange={(ev) => setSelected((s) => (ev.target.checked ? [...s, e.id] : s.filter((x) => x !== e.id)))}
                  />
                  <span className="min-w-0">
                    <span className="font-medium">{e.name}</span> <span className="text-xs text-muted">· {e.department}</span>
                    <span className="block text-[11px] text-muted">{e.baggage === "CHECKED" ? "Checked bag" : "Cabin bag"}{e.note ? ` · ${e.note}` : ""}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}
        {step === 3 && lockToEmployeeId && <p className="text-sm text-muted">You are requesting travel for yourself. Review the previous steps, then submit.</p>}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-4">
        <div className="text-xs text-danger">{error}</div>
        <div className="flex gap-2">
          {step > 0 && <Button variant="secondary" onClick={() => setStep(step - 1)}>Back</Button>}
          {step < 3 ? (
            <Button onClick={() => setStep(step + 1)}>Continue</Button>
          ) : (
            <Button variant="accent" disabled={busy || selected.length === 0} onClick={submit}>
              {busy ? "Creating…" : `Create request (${selected.length} traveler${selected.length === 1 ? "" : "s"})`}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

export function RequestFormCardHeader() {
  return <CardHeader title="Travel request" />;
}
