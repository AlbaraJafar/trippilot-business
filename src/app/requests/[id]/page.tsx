import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Check, Info, Sparkles } from "lucide-react";
import { getCurrentUser, levelOf } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { flightRejections, travelerRejections, type OptFlight } from "@/lib/domain/optimizer";
import { LEVEL_LABEL, type PolicyFinding } from "@/lib/domain/types";
import { loadPolicy } from "@/lib/policy-store";
import { toOptRequest } from "@/lib/services/requests";
import { getFlightProvider } from "@/lib/providers";
import { ActionButton } from "@/components/action-button";
import { AutoRun, CheckoutPanel, PriceWatch } from "@/components/request-client";
import { Badge, Card, CardHeader, cn, DemoBadge, Empty, StatusBadge, Td, Th } from "@/components/ui";

const STEPS = [
  { key: "request", label: "Request" },
  { key: "flights", label: "Flights" },
  { key: "plans", label: "AI plans" },
  { key: "approval", label: "Approval" },
  { key: "payment", label: "PayPal payment" },
  { key: "booking", label: "Booking" },
];
const STEP_OF: Record<string, number> = {
  DRAFT: 0, SEARCHED: 1, PLANNED: 2, PENDING_APPROVAL: 3, CHANGES_REQUESTED: 3, REJECTED: 3, APPROVED: 4, PAYMENT_PENDING: 4, PAID: 5, BOOKED: 6, REFUNDED: 6,
};

const fmtDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export default async function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) notFound();
  const req = await prisma.travelRequest.findFirst({
    where: { id, companyId: user.companyId },
    include: {
      department: true,
      createdBy: true,
      travelers: { include: { employee: true } },
      flightOptions: { orderBy: [{ direction: "asc" }, { date: "asc" }, { departTime: "asc" }] },
      itineraries: {
        orderBy: { createdAt: "asc" },
        include: { assignments: { include: { employee: true, outboundFlight: true, returnFlight: true } } },
      },
      approvals: { orderBy: { createdAt: "desc" }, include: { decidedBy: true } },
      payments: { orderBy: { createdAt: "desc" } },
      bookings: { include: { employee: true } },
      priceAlerts: { include: { flightOption: true }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!req) notFound();
  if (user.role === "EMPLOYEE" && !req.travelers.some((t) => t.employeeId === user.employeeId)) notFound();

  const { config } = await loadPolicy(user.companyId);
  const provider = getFlightProvider();
  const isManager = ["TRAVEL_MANAGER", "ADMIN"].includes(user.role);
  const locked = ["PAYMENT_PENDING", "PAID", "BOOKED", "REFUNDED"].includes(req.status);
  const optReq = toOptRequest(req);
  const step = STEP_OF[req.status] ?? 0;
  const order = { CHEAPEST: 0, BALANCED: 1, CONVENIENT: 2 } as Record<string, number>;
  const plans = [...req.itineraries].sort((a, b) => (order[a.strategy] ?? 9) - (order[b.strategy] ?? 9));
  const selected = plans.find((p) => p.id === req.selectedItineraryId);
  const focus = selected ?? plans.find((p) => p.label.includes("Recommended")) ?? plans[0];
  const approval = req.approvals.find((a) => a.status !== "SUPERSEDED");
  const timeline = await prisma.auditLog.findMany({ where: { OR: [{ entityId: id }, { details: { contains: id } }] }, orderBy: { createdAt: "desc" }, take: 20 });
  const outFlights = req.flightOptions.filter((f) => f.direction === "OUTBOUND");
  const retFlights = req.flightOptions.filter((f) => f.direction === "RETURN");
  const usage = new Map<string, number>();
  focus?.assignments.forEach((a) => [a.outboundFlightId, a.returnFlightId].forEach((x) => x && usage.set(x, (usage.get(x) ?? 0) + 1)));
  const anyDemo = req.flightOptions.some((f) => f.isDemo);
  const outDates: string[] = JSON.parse(req.outboundDates);
  const retDates: string[] = JSON.parse(req.returnDates);

  return (
    <div className="fade-up">
      <Suspense>
        <AutoRun requestId={req.id} shouldRun={isManager && req.status === "DRAFT"} />
      </Suspense>

      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted">
            <Link href="/requests" className="hover:text-ink">Travel requests</Link> / <span className="tabular">{req.code}</span>
          </div>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">{req.title}</h1>
          <p className="mt-1 text-sm text-muted">{req.purpose}</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={req.status} />
          {req.parsedBy && req.parsedBy !== "FORM" && <Badge tone="blue"><Sparkles className="h-3 w-3" /> From AI instruction</Badge>}
        </div>
      </div>

      {/* stepper */}
      <ol className="mb-5 grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-6">
        {STEPS.map((s, i) => (
          <li key={s.key} className={cn("flex items-center gap-2 bg-white px-3 py-2.5 text-xs", i < step ? "text-ink" : i === step ? "font-semibold text-ink" : "text-muted")}>
            <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px]", i < step ? "bg-accent text-white" : i === step ? "bg-navy-900 text-white" : "bg-canvas text-muted")}>
              {i < step ? <Check className="h-3 w-3" /> : i + 1}
            </span>
            {s.label}
          </li>
        ))}
      </ol>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* constraints */}
        <Card className="lg:col-span-2">
          <CardHeader
            title="Requirements"
            subtitle={`${req.travelers.length} traveler(s) · ${req.department.name} · created by ${req.createdBy.name}`}
            action={
              isManager && !locked ? (
                <div className="flex flex-wrap gap-2">
                  <ActionButton url={`/api/requests/${req.id}/search`} variant="secondary" size="sm">
                    {req.flightOptions.length ? "Re-search flights" : "Search flights"}
                  </ActionButton>
                  <ActionButton url={`/api/requests/${req.id}/optimize`} size="sm">
                    <Sparkles className="h-3.5 w-3.5" /> {plans.length ? "Re-optimize" : "Run AI optimization"}
                  </ActionButton>
                </div>
              ) : undefined
            }
          />
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 px-5 py-4 text-sm sm:grid-cols-4">
            <div><dt className="text-xs text-muted">Route</dt><dd className="font-medium">{req.origin} → {req.destination}</dd></div>
            <div><dt className="text-xs text-muted">Outbound</dt><dd>{outDates.map(fmtDate).join(", ")}</dd></div>
            <div><dt className="text-xs text-muted">Return</dt><dd>{retDates.length ? retDates.map(fmtDate).join(", ") : "One-way"}</dd></div>
            <div><dt className="text-xs text-muted">Budget</dt><dd className="tabular">{formatMoney(req.maxPerEmployeeMinor)} pp · {formatMoney(req.totalBudgetMinor)} total</dd></div>
            <div><dt className="text-xs text-muted">Arrive by</dt><dd>{req.arriveBy ?? "—"}</dd></div>
            <div><dt className="text-xs text-muted">Depart after (out)</dt><dd>{req.earliestDeparture ?? "—"}</dd></div>
            <div><dt className="text-xs text-muted">Return departs after</dt><dd>{req.returnDepartAfter ?? "—"}</dd></div>
            <div><dt className="text-xs text-muted">Home by</dt><dd>{req.latestReturn ?? "—"}</dd></div>
            <div className="col-span-2 sm:col-span-4 flex flex-wrap gap-1.5">
              {req.directOnly && <Badge>Direct only</Badge>}
              {req.baggage !== "ANY" && <Badge>Baggage: {req.baggage.toLowerCase()}</Badge>}
              {req.preferredAirlines && <Badge>Airlines: {req.preferredAirlines}</Badge>}
              <Badge>Objective: {req.objective.replace(/_/g, " ").toLowerCase()}</Badge>
              <Badge>Provider: {provider.label}</Badge>
            </div>
          </dl>
          {req.nlInstruction && (
            <div className="border-t border-line px-5 py-3 text-xs text-muted">
              <span className="font-medium text-ink">Instruction:</span> “{req.nlInstruction}”
            </div>
          )}
        </Card>

        {/* approval */}
        <Card>
          <CardHeader title="Approval" subtitle="Purchase authority routing" />
          <div className="px-5 py-4 text-sm">
            {!approval ? (
              <p className="text-muted">Select a plan to evaluate policy and route it for approval.</p>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{LEVEL_LABEL[approval.level]}</span>
                  <StatusBadge status={approval.status} />
                </div>
                <div className="tabular text-lg font-semibold">{formatMoney(approval.amountMinor)}</div>
                <ul className="space-y-1 text-xs text-muted">
                  {(JSON.parse(approval.reasons) as string[]).map((r, i) => <li key={i}>• {r}</li>)}
                </ul>
                {approval.decidedAt && (
                  <p className="text-xs text-muted">
                    {approval.decidedBy?.name ?? "Policy"} · {approval.decidedAt.toLocaleString("en-GB", { timeZone: "Asia/Riyadh", dateStyle: "medium", timeStyle: "short" })}
                    {approval.decisionNote && <> — “{approval.decisionNote}”</>}
                  </p>
                )}
                {approval.status === "PENDING" && levelOf(user.role) >= approval.level && (
                  <Link href="/approvals" className="inline-flex h-8 items-center rounded-md bg-navy-900 px-3 text-xs font-medium text-white">Review in approval inbox</Link>
                )}
                {approval.status === "PENDING" && levelOf(user.role) < approval.level && (
                  <p className="text-xs text-warn">Waiting for {LEVEL_LABEL[approval.level].toLowerCase()} — switch demo account to approve.</p>
                )}
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* plans */}
      {plans.length > 0 && (
        <section className="mt-6">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">AI group plans</h2>
            <span className="text-xs text-muted">Weights: price {config.weights.price} · departure {config.weights.departure} · return {config.weights.return} · duration {config.weights.duration} · airline {config.weights.airline} · baggage {config.weights.baggage}</span>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            {plans.map((p) => {
              const facts = JSON.parse(p.facts) as { savingsMinor?: number; underBudgetByMinor?: number; arrivalSpreadMin?: number; latestArrival?: string | null; unsatisfied?: unknown[] };
              const isSel = p.id === req.selectedItineraryId;
              const rec = p.label.includes("Recommended");
              return (
                <Card key={p.id} className={cn("flex flex-col", isSel ? "border-navy-900 ring-1 ring-navy-900" : rec ? "border-accent/50" : "")}>
                  <div className="flex items-start justify-between gap-2 px-5 pt-4">
                    <div>
                      <div className="text-xs font-medium uppercase tracking-wide text-muted">{p.strategy.toLowerCase()}</div>
                      <div className="text-sm font-semibold">{p.label.replace(" · Recommended", "")}</div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      {rec && <Badge tone="green">Recommended</Badge>}
                      {isSel && <Badge tone="navy">Selected</Badge>}
                    </div>
                  </div>
                  <div className="px-5 py-3">
                    <div className="tabular text-2xl font-semibold tracking-tight">{formatMoney(p.totalMinor)}</div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <StatusBadge status={p.policyStatus} />
                      {!p.feasible && <Badge tone="red">Infeasible</Badge>}
                      <Badge>Score {(p.score / 10).toFixed(0)}/100</Badge>
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div><dt className="text-muted">Under budget by</dt><dd className="tabular font-medium">{formatMoney(Math.max(0, facts.underBudgetByMinor ?? 0))}</dd></div>
                      <div><dt className="text-muted">Saved vs baseline</dt><dd className="tabular font-medium text-accent">{formatMoney(facts.savingsMinor ?? 0)}</dd></div>
                      <div><dt className="text-muted">Latest arrival</dt><dd className="tabular font-medium">{facts.latestArrival ?? "—"}</dd></div>
                      <div><dt className="text-muted">Arrival spread</dt><dd className="tabular font-medium">{facts.arrivalSpreadMin ?? 0} min</dd></div>
                    </dl>
                  </div>
                  <p className="flex-1 border-t border-line px-5 py-3 text-xs leading-relaxed text-ink/80">
                    {p.explanation}
                    <span className="mt-1 block text-[10px] uppercase tracking-wide text-muted">{p.explainedBy === "CLAUDE" ? "Explained by Claude · numbers verified" : "Deterministic explanation"}</span>
                  </p>
                  {isManager && !locked && (
                    <div className="border-t border-line px-5 py-3">
                      <ActionButton url={`/api/requests/${req.id}/select`} body={{ itineraryId: p.id }} size="sm" variant={rec ? "primary" : "secondary"} disabled={!p.feasible || isSel}>
                        {isSel ? "Selected" : "Select & submit for approval"}
                      </ActionButton>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </section>
      )}

      {/* assignments */}
      {focus && (
        <Card className="mt-6">
          <CardHeader
            title={`Itinerary by employee — ${focus.label.replace(" · Recommended", "")}`}
            subtitle="Per-employee policy evaluation. Hard constraints are already enforced; exceptions need approval."
            action={anyDemo ? <DemoBadge label="Simulated flights" /> : undefined}
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px]">
              <thead>
                <tr><Th>Employee</Th><Th>Outbound</Th><Th>Return</Th><Th className="text-right">Price</Th><Th>Policy</Th><Th>Findings</Th></tr>
              </thead>
              <tbody>
                {focus.assignments.map((a) => {
                  const findings = (JSON.parse(a.findings) as PolicyFinding[]).filter((f) => f.severity !== "INFO");
                  return (
                    <tr key={a.id}>
                      <Td>
                        <div className="font-medium">{a.employee.fullName}</div>
                        <div className="text-[11px] text-muted">{a.employee.baggage === "CHECKED" ? "Checked bag" : "Cabin bag"}{a.employee.earliestDeparture ? ` · ≥ ${a.employee.earliestDeparture}` : ""}</div>
                      </Td>
                      <Td>{a.outboundFlight ? <FlightCell f={a.outboundFlight} /> : <span className="text-danger">—</span>}</Td>
                      <Td>{a.returnFlight ? <FlightCell f={a.returnFlight} /> : <span className="text-muted">—</span>}</Td>
                      <Td className="tabular text-right font-medium">{a.outboundFlight ? formatMoney(a.priceMinor) : "—"}</Td>
                      <Td><StatusBadge status={a.policyStatus} /></Td>
                      <Td className="max-w-sm text-xs text-muted">
                        {a.unsatisfiedReason && <div className="text-danger">{a.unsatisfiedReason}</div>}
                        {findings.map((f, i) => (
                          <div key={i} className={f.severity === "VIOLATION" ? "text-danger" : "text-warn"}>
                            {f.message}
                            {f.recommendation && <span className="block text-muted">→ {f.recommendation}</span>}
                          </div>
                        ))}
                        {!findings.length && !a.unsatisfiedReason && "Within policy"}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* payment + booking */}
      {(step >= 4 || req.payments.length > 0) && (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Payment" subtitle="PayPal order lifecycle (separate from booking)" />
            <div className="px-5 py-4">
              {["APPROVED", "PAYMENT_PENDING"].includes(req.status) && <CheckoutPanel requestId={req.id} canPay={isManager} />}
              {req.payments.length > 0 && (
                <ul className="mt-4 divide-y divide-line rounded-md border border-line text-sm">
                  {req.payments.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                      <StatusBadge status={p.status} />
                      <span className="tabular">{formatMoney(p.chargeAmountMinor, p.chargeCurrency, { decimals: p.chargeCurrency !== "SAR" })}</span>
                      <span className="tabular text-xs text-muted">{formatMoney(p.amountMinor)}</span>
                      <span className="font-mono text-[11px] text-muted">{p.paypalOrderId ?? "no PayPal order"}</span>
                      <span className="ml-auto flex items-center gap-3">
                        {p.status === "PAYER_ACTION_REQUIRED" && p.approveUrl && (
                          <a href={p.approveUrl} className="text-xs font-medium text-navy-600 hover:underline">Resume on PayPal</a>
                        )}
                        <Link href={`/payments/${p.id}`} className="text-xs font-medium text-navy-600 hover:underline">Details</Link>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
          <Card>
            <CardHeader title="Booking" subtitle="Supplier reservation status — independent of payment" action={anyDemo ? <DemoBadge label="Simulated" /> : undefined} />
            <div className="px-5 py-4 text-sm">
              {req.bookings.length === 0 ? (
                <p className="text-muted">
                  {req.status === "PAID" ? "Creating holds…" : "Not started. Holds are created after the payment is captured."}
                </p>
              ) : (
                <>
                  <ul className="divide-y divide-line rounded-md border border-line">
                    {req.bookings.map((b) => (
                      <li key={b.id} className="flex items-center gap-3 px-3 py-2">
                        <span className="flex-1">{b.employee.fullName}</span>
                        <span className="font-mono text-[11px] text-muted">{b.reference}</span>
                        <StatusBadge status={b.status} />
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 flex gap-2 text-xs text-muted">
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {anyDemo
                      ? "These are simulated holds against demo inventory. No airline reservation or ticket exists; SIM- references are not PNRs. A captured PayPal payment does not mean a ticket was issued."
                      : "Ticketing must be confirmed by the supplier."}
                  </p>
                  {req.status === "PAID" && isManager && (
                    <div className="mt-3">
                      <ActionButton url={`/api/requests/${req.id}/bookings`} size="sm" variant="secondary">Confirm simulated booking</ActionButton>
                    </div>
                  )}
                </>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* flights */}
      {req.flightOptions.length > 0 && (
        <Card className="mt-6">
          <CardHeader
            title="Flight options"
            subtitle={`${outFlights.length} outbound · ${retFlights.length} return · rejected flights show which hard constraint they break`}
            action={
              <div className="flex items-center gap-2">
                {anyDemo && <DemoBadge />}
                {isManager && req.priceAlerts.length > 0 && <ActionButton url="/api/alerts/refresh" size="sm" variant="secondary">Refresh watched fares</ActionButton>}
              </div>
            }
          />
          {anyDemo && (
            <div className="border-b border-line bg-warn-soft/50 px-5 py-2 text-xs text-warn">
              Simulated schedules and fares from TripPilot&apos;s demo provider. Airline codes are for realism only — not real-time availability or airline prices.
            </div>
          )}
          {[["Outbound", outFlights], ["Return", retFlights]].map(([label, list]) => (
            <div key={label as string} className="overflow-x-auto">
              <div className="px-5 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-muted">{label as string}</div>
              <table className="w-full min-w-[900px]">
                <thead>
                  <tr><Th>Flight</Th><Th>Date</Th><Th>Times</Th><Th>Cabin / bag</Th><Th>Seats</Th><Th className="text-right">Fare</Th><Th>Eligibility</Th><Th>Plan use</Th><Th /></tr>
                </thead>
                <tbody>
                  {(list as typeof outFlights).map((f) => {
                    const rej = flightRejections(f as unknown as OptFlight, optReq, config);
                    const someTravelerBlocked = req.travelers.filter((t) => travelerRejections(f as unknown as OptFlight, t.employee as never).length > 0).length;
                    return (
                      <tr key={f.id} className={rej.length ? "opacity-60" : ""}>
                        <Td><div className="font-medium">{f.flightNumber}</div><div className="text-[11px] text-muted">{f.airlineName}{f.stops ? ` · ${f.stops} stop` : " · direct"}</div></Td>
                        <Td className="text-xs">{fmtDate(f.date)}</Td>
                        <Td className="tabular">{f.departTime} → {f.arriveTime}{f.arriveDayOffset ? <sup>+{f.arriveDayOffset}</sup> : null}</Td>
                        <Td className="text-xs">{f.cabin.toLowerCase()} · {f.baggage === "CHECKED" ? `${f.baggageKg}kg checked` : `${f.baggageKg}kg cabin`}{f.refundable ? " · refundable" : ""}</Td>
                        <Td className="tabular text-xs">{f.seatsLeft}</Td>
                        <Td className="tabular text-right font-medium">{formatMoney(f.priceMinor)}</Td>
                        <Td className="text-xs">
                          {rej.length ? <span className="text-danger">{rej.join("; ")}</span> : <span className="text-accent">Eligible{someTravelerBlocked ? ` · not for ${someTravelerBlocked} traveler(s)` : ""}</span>}
                        </Td>
                        <Td className="tabular text-xs">{usage.get(f.id) ? `${usage.get(f.id)} pax` : ""}</Td>
                        <Td>{isManager && !rej.length && <PriceWatch flightOptionId={f.id} currentSar={f.priceMinor / 100} />}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </Card>
      )}

      {req.priceAlerts.length > 0 && (
        <Card className="mt-6">
          <CardHeader title="Price monitoring" subtitle="Watched fares. Demo inventory uses simulated fare movements." />
          <table className="w-full">
            <thead><tr><Th>Flight</Th><Th className="text-right">Current</Th><Th className="text-right">Target</Th><Th>Status</Th><Th>History</Th></tr></thead>
            <tbody>
              {req.priceAlerts.map((a) => (
                <tr key={a.id}>
                  <Td>{a.flightOption.flightNumber} {a.isSimulated && <Badge tone="amber">simulated</Badge>}</Td>
                  <Td className="tabular text-right">{formatMoney(a.currentMinor)}</Td>
                  <Td className="tabular text-right">{formatMoney(a.targetMinor)}</Td>
                  <Td><StatusBadge status={a.status} /></Td>
                  <Td className="tabular text-xs text-muted">{(JSON.parse(a.history) as { priceMinor: number }[]).slice(-6).map((h) => Math.round(h.priceMinor / 100)).join(" → ")}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Card className="mt-6">
        <CardHeader title="Audit trail" />
        {timeline.length === 0 ? (
          <Empty>No events.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {timeline.map((t) => (
              <li key={t.id} className="flex flex-wrap gap-x-4 px-5 py-2 text-xs">
                <span className="tabular w-36 text-muted">{t.createdAt.toLocaleString("en-GB", { timeZone: "Asia/Riyadh", dateStyle: "short", timeStyle: "medium" })}</span>
                <span className="w-48 font-medium">{t.action.replace(/_/g, " ").toLowerCase()}</span>
                <span className="text-muted">{t.actorName}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function FlightCell({ f }: { f: { flightNumber: string; departTime: string; arriveTime: string; arriveDayOffset: number; date: string; isDemo: boolean } }) {
  return (
    <div>
      <div className="font-medium">{f.flightNumber}</div>
      <div className="tabular text-[11px] text-muted">{f.date.slice(5)} · {f.departTime}–{f.arriveTime}{f.arriveDayOffset ? "+1" : ""}</div>
    </div>
  );
}
