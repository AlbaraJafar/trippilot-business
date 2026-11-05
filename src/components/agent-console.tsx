"use client";

import { useState } from "react";
import { Bot, Sparkles, User } from "lucide-react";
import { Badge, Button, Card, Textarea } from "./ui";
import { postJSON } from "./action-button";
import { RequestForm, type DeptOpt, type EmployeeOpt } from "./request-form";
import type { TravelRequirements } from "@/lib/domain/types";

interface ParseResponse {
  requirements: TravelRequirements;
  warnings: string[];
  engine: "CLAUDE" | "DETERMINISTIC";
  suggestedEmployeeIds: string[];
}

const EXAMPLES = [
  "Arrange a trip for 10 employees from Riyadh to Jeddah on March 15. They need to arrive before 10 AM and return after 5 PM on March 16. Keep the total below SAR 15,000. Direct flights only.",
  "Find the cheapest flights for 4 engineers from Jeddah to Madinah on 2 April, back on 3 April evening. Do not exceed SAR 1,200 per employee. Checked bags needed.",
  "Send 3 consultants from Riyadh to Dammam on 2027-02-10, arrive by 9 AM, return the same day after 6 PM. Budget SAR 900 per person.",
];

function fmtSummary(r: TravelRequirements) {
  const rows: [string, string][] = [
    ["Route", `${r.origin} → ${r.destination}`],
    ["Travelers", String(r.travelerCount)],
    ["Outbound", r.outboundDates.join(", ") + (r.arriveBy ? ` · arrive by ${r.arriveBy}` : "") + (r.earliestDeparture ? ` · depart after ${r.earliestDeparture}` : "")],
    ["Return", r.returnDates.length ? r.returnDates.join(", ") + (r.returnDepartAfter ? ` · depart after ${r.returnDepartAfter}` : "") + (r.latestReturn ? ` · home by ${r.latestReturn}` : "") : "One-way"],
    ["Budget", `SAR ${r.maxPerEmployeeSar.toLocaleString("en")} per employee · SAR ${r.totalBudgetSar.toLocaleString("en")} total`],
    ["Rules", [r.directOnly && "Direct only", r.baggage !== "ANY" && `Baggage: ${r.baggage.toLowerCase()}`, r.preferredAirlines.length && `Airlines: ${r.preferredAirlines.join(", ")}`, `Objective: ${r.objective.replace(/_/g, " ").toLowerCase()}`].filter(Boolean).join(" · ")],
  ];
  return rows;
}

export function AgentConsole({ employees, departments, claude }: { employees: EmployeeOpt[]; departments: DeptOpt[]; claude: boolean }) {
  const [text, setText] = useState(EXAMPLES[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [turns, setTurns] = useState<{ prompt: string; result: ParseResponse; key: number }[]>([]);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const result = await postJSON<ParseResponse>("/api/agent/parse", { text });
      setTurns((t) => [...t, { prompt: text, result, key: Date.now() }]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const last = turns[turns.length - 1];

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <Card className="flex flex-col lg:col-span-2">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold"><Bot className="h-4 w-4" /> TripPilot agent</div>
          <Badge tone={claude ? "green" : "neutral"}>{claude ? "Claude connected" : "Deterministic parser"}</Badge>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm lg:max-h-[520px]">
          <div className="flex gap-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-navy-900 text-white"><Bot className="h-3.5 w-3.5" /></div>
            <p className="text-muted">
              Tell me who needs to travel, where, when they must arrive and the budget. I&apos;ll turn it into a structured request,
              search flights, enforce hard constraints and company policy, and prepare a plan for approval and PayPal payment.
            </p>
          </div>
          {turns.map((t) => (
            <div key={t.key} className="space-y-3">
              <div className="flex gap-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-canvas"><User className="h-3.5 w-3.5" /></div>
                <p>{t.prompt}</p>
              </div>
              <div className="flex gap-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-navy-900 text-white"><Bot className="h-3.5 w-3.5" /></div>
                <div className="min-w-0 flex-1">
                  <p className="mb-2">
                    Here&apos;s what I extracted{" "}
                    <Badge tone={t.result.engine === "CLAUDE" ? "green" : "neutral"}>{t.result.engine === "CLAUDE" ? "via Claude · Zod-validated" : "via deterministic parser"}</Badge>
                  </p>
                  <dl className="divide-y divide-line rounded-md border border-line text-xs">
                    {fmtSummary(t.result.requirements).map(([k, v]) => (
                      <div key={k} className="flex gap-3 px-3 py-1.5">
                        <dt className="w-20 shrink-0 text-muted">{k}</dt>
                        <dd className="min-w-0">{v}</dd>
                      </div>
                    ))}
                  </dl>
                  {t.result.warnings.length > 0 && (
                    <ul className="mt-2 space-y-1 text-xs text-warn">
                      {t.result.warnings.map((w, i) => <li key={i}>⚠ {w}</li>)}
                    </ul>
                  )}
                  <p className="mt-2 text-xs text-muted">Review and adjust the request on the right, then create it — I&apos;ll search and optimize immediately.</p>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="border-t border-line p-4">
          <Textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="Describe the trip…" />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button onClick={send} disabled={busy || text.trim().length < 10}>
              <Sparkles className="h-4 w-4" /> {busy ? "Thinking…" : "Plan this trip"}
            </Button>
            {EXAMPLES.map((ex, i) => (
              <button key={i} onClick={() => setText(ex)} className="rounded border border-line px-2 py-1 text-[11px] text-muted hover:text-ink">
                Example {i + 1}
              </button>
            ))}
          </div>
          {error && <p className="mt-2 text-xs text-danger">{error}</p>}
        </div>
      </Card>

      <div className="lg:col-span-3">
        {last ? (
          <RequestForm
            key={last.key}
            initial={last.result.requirements}
            employees={employees}
            departments={departments}
            initialEmployeeIds={last.result.suggestedEmployeeIds}
            nlInstruction={last.prompt}
            parsedBy={last.result.engine}
            afterCreateQuery="?autorun=1"
          />
        ) : (
          <Card className="flex h-full min-h-60 items-center justify-center p-8 text-center text-sm text-muted">
            The structured request appears here for review before anything is created.
            <br />
            Nothing is booked or paid without explicit human approval.
          </Card>
        )}
      </div>
    </div>
  );
}
