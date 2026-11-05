"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Card, CardHeader, Input, Label } from "./ui";
import { postJSON } from "./action-button";
import type { ScoringWeights } from "@/lib/domain/types";

export interface PolicyFormValues {
  standardMaxSar: number;
  seniorMaxSar: number;
  executiveMaxSar: number;
  allowedCabins: string[];
  preferredAirlines: string[];
  directPreferred: boolean;
  minAdvanceDays: number;
  maxTripBudgetSar: number;
  managerApprovalMaxSar: number;
  deptHeadApprovalMaxSar: number;
  groupDeptHeadSar: number;
  autoExecuteMaxSar: number;
  weights: ScoringWeights;
}

export function PolicyForm({ initial, editable }: { initial: PolicyFormValues; editable: boolean }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [airlines, setAirlines] = useState(initial.preferredAirlines.join(", "));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const num = (k: keyof PolicyFormValues) => (
    <Input type="number" min={0} disabled={!editable} value={v[k] as number} onChange={(e) => setV({ ...v, [k]: parseInt(e.target.value || "0", 10) })} />
  );
  const weightTotal = Object.values(v.weights).reduce((a, b) => a + b, 0);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await postJSON("/api/policy", { ...v, preferredAirlines: airlines.split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean) });
      setMsg({ ok: true, text: "Policy saved. New plans and approvals use it immediately." });
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Fare limits by grade" subtitle="Per round trip, SAR. The stricter of grade limit and personal limit applies." />
        <div className="grid grid-cols-3 gap-3 p-5">
          <div><Label>Standard employee</Label>{num("standardMaxSar")}</div>
          <div><Label>Senior manager</Label>{num("seniorMaxSar")}</div>
          <div><Label>Executive</Label>{num("executiveMaxSar")}</div>
        </div>
      </Card>
      <Card>
        <CardHeader title="Payment approval thresholds" subtitle="Who must sign off before money moves" />
        <div className="grid grid-cols-2 gap-3 p-5">
          <div><Label>Travel manager may approve ≤ (per employee)</Label>{num("managerApprovalMaxSar")}</div>
          <div><Label>Department head ≤ (per employee); above → executive</Label>{num("deptHeadApprovalMaxSar")}</div>
          <div><Label>Group total above → department head</Label>{num("groupDeptHeadSar")}</div>
          <div><Label>Auto-execute limit (0 = never)</Label>{num("autoExecuteMaxSar")}</div>
        </div>
      </Card>
      <Card>
        <CardHeader title="Company-wide rules" />
        <div className="grid grid-cols-2 gap-3 p-5">
          <div><Label>Maximum total trip budget (SAR)</Label>{num("maxTripBudgetSar")}</div>
          <div><Label>Minimum advance booking (days)</Label>{num("minAdvanceDays")}</div>
          <div>
            <Label>Allowed cabin classes</Label>
            <div className="flex gap-3 pt-1 text-sm">
              {["ECONOMY", "PREMIUM", "BUSINESS"].map((c) => (
                <label key={c} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    disabled={!editable}
                    checked={v.allowedCabins.includes(c)}
                    onChange={(e) => setV({ ...v, allowedCabins: e.target.checked ? [...v.allowedCabins, c] : v.allowedCabins.filter((x) => x !== c) })}
                  />
                  {c.toLowerCase()}
                </label>
              ))}
            </div>
          </div>
          <div><Label>Preferred airlines (IATA)</Label><Input disabled={!editable} value={airlines} onChange={(e) => setAirlines(e.target.value)} placeholder="SV, XY" /></div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" disabled={!editable} checked={v.directPreferred} onChange={(e) => setV({ ...v, directPreferred: e.target.checked })} /> Direct flights preferred
          </label>
        </div>
      </Card>
      <Card>
        <CardHeader title="Optimization scoring weights" subtitle={`Normalised automatically (current total ${weightTotal}). Hard constraints are never traded for score.`} />
        <div className="grid grid-cols-3 gap-3 p-5">
          {(Object.keys(v.weights) as (keyof ScoringWeights)[]).map((k) => (
            <div key={k}>
              <Label className="capitalize">{k}</Label>
              <Input
                type="number"
                min={0}
                max={100}
                disabled={!editable}
                value={v.weights[k]}
                onChange={(e) => setV({ ...v, weights: { ...v.weights, [k]: parseInt(e.target.value || "0", 10) } })}
              />
            </div>
          ))}
        </div>
      </Card>
      <div className="flex items-center gap-3 lg:col-span-2">
        {editable ? <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save policy"}</Button> : <p className="text-sm text-muted">Only administrators can change policy.</p>}
        {msg && <span className={`text-sm ${msg.ok ? "text-accent" : "text-danger"}`}>{msg.text}</span>}
      </div>
    </div>
  );
}
