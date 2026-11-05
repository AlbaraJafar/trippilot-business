import { formatMoney } from "../money";
import { cabinAllowed, effectiveLimit, evaluateTravelerTrip, statusFromFindings, type PolicyConfig } from "./policy";
import type { PolicyFinding, PolicyStatus, ScoringWeights } from "./types";

/**
 * Hybrid itinerary optimizer.
 *  1. Hard constraints filter flights per traveler (never traded off for score).
 *  2. Candidate round trips are scored with a transparent, normalised weighted model.
 *  3. A capacity-aware greedy assignment (most-constrained traveler first) builds
 *     complete group plans for each strategy.
 * Everything here is deterministic and pure — easy to test, impossible for an LLM to bend.
 */

export interface OptFlight {
  id: string;
  direction: "OUTBOUND" | "RETURN";
  airline: string;
  flightNumber: string;
  date: string;
  departTime: string;
  arriveTime: string;
  arriveDayOffset: number;
  durationMin: number;
  stops: number;
  cabin: string;
  baggage: string;
  seatsLeft: number;
  priceMinor: number;
}

export interface OptTraveler {
  employeeId: string;
  name: string;
  grade: string;
  budgetLimitMinor: number;
  preferredAirline: string | null;
  preferredDeparture: string;
  earliestDeparture: string | null;
  baggage: string;
}

export interface OptRequest {
  outboundDates: string[];
  returnDates: string[];
  arriveBy: string | null;
  earliestDeparture: string | null;
  returnDepartAfter: string | null;
  latestReturn: string | null;
  maxPerEmployeeMinor: number;
  totalBudgetMinor: number;
  preferredAirlines: string[];
  baggage: string;
  directOnly: boolean;
}

export type Strategy = "CHEAPEST" | "BALANCED" | "CONVENIENT";
export const STRATEGY_LABEL: Record<Strategy, string> = {
  CHEAPEST: "Cheapest complete plan",
  BALANCED: "Best overall balance",
  CONVENIENT: "Most convenient",
};

const CONVENIENT_WEIGHTS: ScoringWeights = { price: 10, departure: 35, return: 35, duration: 10, airline: 5, baggage: 5 };

export const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const arrivalMin = (f: OptFlight) => toMin(f.arriveTime) + f.arriveDayOffset * 1440;

/* ---------------------------------------------------------------- feasibility */

/** Request-level reasons a flight can never be used (shown in the flight table). */
export function flightRejections(f: OptFlight, r: OptRequest, policy: PolicyConfig): string[] {
  const reasons: string[] = [];
  if (f.direction === "OUTBOUND") {
    if (!r.outboundDates.includes(f.date)) reasons.push("Outside outbound dates");
    if (r.earliestDeparture && toMin(f.departTime) < toMin(r.earliestDeparture)) reasons.push(`Departs before ${r.earliestDeparture}`);
    if (r.arriveBy && (f.arriveDayOffset > 0 || toMin(f.arriveTime) > toMin(r.arriveBy))) reasons.push(`Arrives after ${r.arriveBy} deadline`);
  } else {
    if (!r.returnDates.includes(f.date)) reasons.push("Outside return dates");
    if (r.returnDepartAfter && toMin(f.departTime) < toMin(r.returnDepartAfter)) reasons.push(`Departs before ${r.returnDepartAfter}`);
    if (r.latestReturn && arrivalMin(f) > toMin(r.latestReturn)) reasons.push(`Lands after ${r.latestReturn} latest return`);
  }
  if (r.directOnly && f.stops > 0) reasons.push("Not direct (direct only)");
  if (r.baggage === "CHECKED" && f.baggage !== "CHECKED") reasons.push("No checked bag (required)");
  if (!cabinAllowed(policy, f.cabin)) reasons.push(`${f.cabin} cabin not permitted by policy`);
  if (f.seatsLeft <= 0) reasons.push("Sold out");
  return reasons;
}

/** Traveler-specific hard constraints on top of request-level ones. */
export function travelerRejections(f: OptFlight, t: OptTraveler): string[] {
  const reasons: string[] = [];
  if (t.baggage === "CHECKED" && f.baggage !== "CHECKED") reasons.push("needs checked baggage");
  if (f.direction === "OUTBOUND" && t.earliestDeparture && toMin(f.departTime) < toMin(t.earliestDeparture))
    reasons.push(`cannot depart before ${t.earliestDeparture}`);
  return reasons;
}

/* ---------------------------------------------------------------- scoring */

const IDEAL: Record<string, number> = { EARLY: 330, MORNING: 480, AFTERNOON: 840, EVENING: 1140 };

function idealOutbound(t: OptTraveler, r: OptRequest, f: OptFlight): number {
  if (IDEAL[t.preferredDeparture] !== undefined) return IDEAL[t.preferredDeparture];
  if (r.arriveBy) return toMin(r.arriveBy) - f.durationMin - 75; // land ~75 min before the deadline
  return 540;
}
function idealReturn(t: OptTraveler, r: OptRequest): number {
  if (t.preferredDeparture === "EVENING") return 1140;
  if (r.returnDepartAfter) return toMin(r.returnDepartAfter) + 60;
  return 1080;
}

export interface CandidatePair {
  out: OptFlight;
  ret: OptFlight | null;
  priceMinor: number;
  components: Record<keyof ScoringWeights, number>; // 0..1
  score: number; // 0..1000
  convenientScore: number;
  withinBudget: boolean;
}

function weighted(c: Record<keyof ScoringWeights, number>, w: ScoringWeights): number {
  const total = w.price + w.departure + w.return + w.duration + w.airline + w.baggage || 1;
  const s =
    c.price * w.price + c.departure * w.departure + c.return * w.return + c.duration * w.duration + c.airline * w.airline + c.baggage * w.baggage;
  return Math.round((s / total) * 1000);
}

function norm(v: number, min: number, max: number, invert = true): number {
  if (max === min) return 1;
  const x = (v - min) / (max - min);
  return invert ? 1 - x : x;
}

export function buildCandidates(
  t: OptTraveler,
  outs: OptFlight[],
  rets: OptFlight[],
  r: OptRequest,
  policy: PolicyConfig,
): CandidatePair[] {
  const oneWay = r.returnDates.length === 0;
  const raw: { out: OptFlight; ret: OptFlight | null }[] = [];
  for (const o of outs) {
    if (oneWay) raw.push({ out: o, ret: null });
    else
      for (const rt of rets) {
        if (rt.date < o.date) continue;
        if (rt.date === o.date && toMin(rt.departTime) < arrivalMin(o) + 120) continue;
        raw.push({ out: o, ret: rt });
      }
  }
  if (!raw.length) return [];
  const prices = raw.map((p) => p.out.priceMinor + (p.ret?.priceMinor ?? 0));
  const durs = raw.map((p) => p.out.durationMin + (p.ret?.durationMin ?? 0));
  const [pMin, pMax, dMin, dMax] = [Math.min(...prices), Math.max(...prices), Math.min(...durs), Math.max(...durs)];
  const prefAirlines = [t.preferredAirline, ...r.preferredAirlines, ...policy.preferredAirlines].filter(Boolean) as string[];

  return raw.map((p, i) => {
    const flights = [p.out, ...(p.ret ? [p.ret] : [])];
    const depDiff = Math.abs(toMin(p.out.departTime) - idealOutbound(t, r, p.out));
    const retDiff = p.ret ? Math.abs(toMin(p.ret.departTime) - idealReturn(t, r)) : 0;
    const airlineHits = flights.filter((f) => prefAirlines.includes(f.airline)).length;
    const bag = flights.reduce((a, f) => a + (t.baggage === "CHECKED" ? (f.baggage === "CHECKED" ? 1 : 0) : f.baggage === "CABIN" ? 1 : 0.7), 0) / flights.length;
    const components = {
      price: norm(prices[i], pMin, pMax),
      departure: Math.max(0, 1 - depDiff / 360),
      return: p.ret ? Math.max(0, 1 - retDiff / 360) : 1,
      duration: norm(durs[i], dMin, dMax),
      airline: prefAirlines.length ? airlineHits / flights.length : 1,
      baggage: bag,
    };
    return {
      out: p.out,
      ret: p.ret,
      priceMinor: prices[i],
      components,
      score: weighted(components, policy.weights),
      convenientScore: weighted(components, CONVENIENT_WEIGHTS),
      withinBudget: prices[i] <= r.maxPerEmployeeMinor,
    };
  });
}

/* ---------------------------------------------------------------- plans */

export interface PlanAssignment {
  employeeId: string;
  name: string;
  outFlightId: string | null;
  retFlightId: string | null;
  priceMinor: number;
  score: number;
  policyStatus: PolicyStatus;
  findings: PolicyFinding[];
  budgetException: boolean;
  unsatisfiedReason: string | null;
}

export interface PlanFacts {
  strategy: Strategy;
  travelerCount: number;
  assignedCount: number;
  totalMinor: number;
  totalBudgetMinor: number;
  underBudgetByMinor: number;
  baselineMinor: number;
  savingsMinor: number;
  arriveBy: string | null;
  latestArrival: string | null;
  arrivalSpreadMin: number;
  outboundGroups: { flight: string; departTime: string; count: number }[];
  returnGroups: { flight: string; departTime: string; count: number }[];
  exceptions: { name: string; priceMinor: number; limitMinor: number; overMinor: number; reason: string }[];
  unsatisfied: { name: string; reason: string }[];
  avgScore: number;
}

export interface GroupPlan {
  strategy: Strategy;
  label: string;
  feasible: boolean;
  totalMinor: number;
  baselineMinor: number;
  score: number;
  policyStatus: PolicyStatus;
  assignments: PlanAssignment[];
  facts: PlanFacts;
}

interface TravelerCtx {
  t: OptTraveler;
  inBudget: CandidatePair[];
  all: CandidatePair[];
  unsatisfiedReason: string | null;
  baselineMinor: number;
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
}

function explainNoOption(t: OptTraveler, outs: OptFlight[], rets: OptFlight[], r: OptRequest): string {
  const outOk = outs.filter((f) => travelerRejections(f, t).length === 0);
  if (!outOk.length) {
    const why = outs.length ? travelerRejections(outs[0], t).join(", ") : "no eligible outbound flights";
    return `No outbound flight meets the request window and ${t.name.split(" ")[0]}'s constraint (${why}).`;
  }
  if (r.returnDates.length) {
    const retOk = rets.filter((f) => travelerRejections(f, t).length === 0);
    if (!retOk.length) return `No return flight meets the return window with ${t.baggage === "CHECKED" ? "checked baggage" : "the requirements"}.`;
  }
  return "No outbound/return combination is compatible.";
}

export function optimize(
  travelers: OptTraveler[],
  flights: OptFlight[],
  r: OptRequest,
  policy: PolicyConfig,
  todayISO: string,
): GroupPlan[] {
  const eligible = flights.filter((f) => flightRejections(f, r, policy).length === 0);
  const outsAll = eligible.filter((f) => f.direction === "OUTBOUND");
  const retsAll = eligible.filter((f) => f.direction === "RETURN");
  const byId = new Map(flights.map((f) => [f.id, f]));

  const ctxs: TravelerCtx[] = travelers.map((t) => {
    const outs = outsAll.filter((f) => travelerRejections(f, t).length === 0);
    const rets = retsAll.filter((f) => travelerRejections(f, t).length === 0);
    const all = buildCandidates(t, outs, rets, r, policy);
    return {
      t,
      all,
      inBudget: all.filter((c) => c.withinBudget),
      unsatisfiedReason: all.length ? null : explainNoOption(t, outsAll, retsAll, r),
      baselineMinor: median(all.map((c) => c.priceMinor)),
    };
  });

  const baselineMinor = ctxs.reduce((a, c) => a + c.baselineMinor, 0);
  const strategies: Strategy[] = ["CHEAPEST", "BALANCED", "CONVENIENT"];
  return strategies.map((s) => buildPlan(s, ctxs, r, policy, todayISO, byId, baselineMinor));
}

function buildPlan(
  strategy: Strategy,
  ctxs: TravelerCtx[],
  r: OptRequest,
  policy: PolicyConfig,
  todayISO: string,
  byId: Map<string, OptFlight>,
  baselineMinor: number,
): GroupPlan {
  const seats = new Map<string, number>();
  const used = new Map<string, number>();
  const seatsLeft = (f: OptFlight) => seats.get(f.id) ?? f.seatsLeft;
  const hasSeat = (c: CandidatePair) => seatsLeft(c.out) > 0 && (!c.ret || seatsLeft(c.ret) > 0);

  const value = (c: CandidatePair): number => {
    const cohesion = ((used.get(c.out.id) ?? 0) > 0 ? 1 : 0) + (c.ret && (used.get(c.ret.id) ?? 0) > 0 ? 1 : 0);
    if (strategy === "CHEAPEST") return -c.priceMinor * 10 + c.score / 100; // price dominates, score tie-breaks
    if (strategy === "CONVENIENT") return c.convenientScore + cohesion * 15;
    return c.score + cohesion * 40; // BALANCED: keep colleagues on the same flights
  };

  // Most-constrained travelers first: fewest in-budget options, then fewest options overall.
  // Travelers needing a budget exception go first so they get scarce seats they cannot live without.
  const order = [...ctxs].sort((a, b) => {
    const ka = a.inBudget.length === 0 ? -1 : a.inBudget.length;
    const kb = b.inBudget.length === 0 ? -1 : b.inBudget.length;
    return ka - kb || a.all.length - b.all.length;
  });

  const assignments: PlanAssignment[] = [];
  for (const ctx of order) {
    const { t } = ctx;
    const pool = (ctx.inBudget.length ? ctx.inBudget : ctx.all).filter(hasSeat);
    if (!pool.length) {
      assignments.push({
        employeeId: t.employeeId,
        name: t.name,
        outFlightId: null,
        retFlightId: null,
        priceMinor: 0,
        score: 0,
        policyStatus: "POLICY_VIOLATION",
        findings: [],
        budgetException: false,
        unsatisfiedReason: ctx.unsatisfiedReason ?? "All compatible flights are full for this group.",
      });
      continue;
    }
    const best = pool.reduce((a, b) => (value(b) > value(a) ? b : a));
    for (const f of [best.out, best.ret]) {
      if (!f) continue;
      seats.set(f.id, seatsLeft(f) - 1);
      used.set(f.id, (used.get(f.id) ?? 0) + 1);
    }
    const budgetException = !best.withinBudget;
    const cheapestAll = Math.min(...ctx.all.map((c) => c.priceMinor));
    const evalRes = evaluateTravelerTrip(
      policy,
      t,
      [best.out, ...(best.ret ? [best.ret] : [])],
      todayISO,
      { cheapestCompliantMinor: cheapestAll },
    );
    const findings = [...evalRes.findings];
    if (budgetException) {
      findings.unshift({
        rule: "REQUEST_MAX_PER_EMPLOYEE",
        severity: "REQUIRES_APPROVAL",
        message: `No itinerary within the request's ${formatMoney(r.maxPerEmployeeMinor)} cap satisfies ${t.name.split(" ")[0]}'s constraints; cheapest compatible option is ${formatMoney(best.priceMinor)} (+${formatMoney(best.priceMinor - r.maxPerEmployeeMinor)}).`,
        actual: formatMoney(best.priceMinor),
        allowed: formatMoney(r.maxPerEmployeeMinor),
        recommendation: "Approve the exception, relax the traveler constraint, or remove the traveler.",
      });
    }
    assignments.push({
      employeeId: t.employeeId,
      name: t.name,
      outFlightId: best.out.id,
      retFlightId: best.ret?.id ?? null,
      priceMinor: best.priceMinor,
      score: strategy === "CONVENIENT" ? best.convenientScore : best.score,
      policyStatus: statusFromFindings(findings),
      findings,
      budgetException,
      unsatisfiedReason: null,
    });
  }

  // keep original traveler order for display
  const idx = new Map(ctxs.map((c, i) => [c.t.employeeId, i]));
  assignments.sort((a, b) => idx.get(a.employeeId)! - idx.get(b.employeeId)!);

  const assigned = assignments.filter((a) => a.outFlightId);
  const totalMinor = assigned.reduce((a, x) => a + x.priceMinor, 0);
  const unsatisfied = assignments.filter((a) => !a.outFlightId).map((a) => ({ name: a.name, reason: a.unsatisfiedReason! }));
  const feasible = unsatisfied.length === 0 && totalMinor <= r.totalBudgetMinor && totalMinor <= policy.maxTripBudgetMinor;

  const group = (dir: "out" | "ret") => {
    const m = new Map<string, number>();
    for (const a of assigned) {
      const id = dir === "out" ? a.outFlightId : a.retFlightId;
      if (id) m.set(id, (m.get(id) ?? 0) + 1);
    }
    return [...m.entries()]
      .map(([id, count]) => ({ flight: byId.get(id)!.flightNumber, departTime: byId.get(id)!.departTime, count }))
      .sort((a, b) => b.count - a.count);
  };
  const arrivals = assigned.map((a) => byId.get(a.outFlightId!)!).map((f) => toMin(f.arriveTime));
  const latest = arrivals.length ? Math.max(...arrivals) : null;
  const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

  const policyStatus: PolicyStatus = !feasible
    ? "POLICY_VIOLATION"
    : assigned.some((a) => a.policyStatus === "POLICY_VIOLATION")
      ? "POLICY_VIOLATION"
      : assigned.some((a) => a.policyStatus === "REQUIRES_APPROVAL")
        ? "REQUIRES_APPROVAL"
        : "COMPLIANT";

  const avgScore = assigned.length ? Math.round(assigned.reduce((a, x) => a + x.score, 0) / assigned.length) : 0;
  const facts: PlanFacts = {
    strategy,
    travelerCount: ctxs.length,
    assignedCount: assigned.length,
    totalMinor,
    totalBudgetMinor: r.totalBudgetMinor,
    underBudgetByMinor: r.totalBudgetMinor - totalMinor,
    baselineMinor,
    savingsMinor: Math.max(0, baselineMinor - totalMinor),
    arriveBy: r.arriveBy,
    latestArrival: latest !== null ? fmt(latest) : null,
    arrivalSpreadMin: arrivals.length ? Math.max(...arrivals) - Math.min(...arrivals) : 0,
    outboundGroups: group("out"),
    returnGroups: group("ret"),
    exceptions: assigned
      .filter((a) => a.policyStatus !== "COMPLIANT")
      .map((a) => {
        const ctx = ctxs.find((c) => c.t.employeeId === a.employeeId)!;
        const limit = Math.min(r.maxPerEmployeeMinor, effectiveLimit(policy, ctx.t));
        return {
          name: a.name,
          priceMinor: a.priceMinor,
          limitMinor: limit,
          overMinor: Math.max(0, a.priceMinor - limit),
          reason: a.findings.find((f) => f.severity !== "INFO")?.message ?? "",
        };
      }),
    unsatisfied,
    avgScore,
  };

  return {
    strategy,
    label: STRATEGY_LABEL[strategy],
    feasible,
    totalMinor,
    baselineMinor,
    score: avgScore,
    policyStatus,
    assignments,
    facts,
  };
}

/** Pick the plan TripPilot recommends: best balanced feasible plan, falling back to cheapest feasible. */
export function recommend(plans: GroupPlan[]): Strategy | null {
  const feasible = plans.filter((p) => p.feasible);
  if (!feasible.length) return null;
  return (feasible.find((p) => p.strategy === "BALANCED") ?? feasible[0]).strategy;
}
