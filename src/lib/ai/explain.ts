import { formatMoney } from "../money";
import type { PlanFacts } from "../domain/optimizer";

/** Deterministic, numbers-from-data explanation of a group plan. */
export function explainPlanDeterministic(f: PlanFacts, label: string): string {
  const parts: string[] = [];
  const n = f.travelerCount;
  if (f.unsatisfied.length) {
    parts.push(
      `${label}: ${f.assignedCount} of ${n} travelers could be routed for ${formatMoney(f.totalMinor)}. ${f.unsatisfied
        .map((u) => `${u.name} cannot be accommodated — ${u.reason}`)
        .join(" ")}`,
    );
  } else {
    parts.push(`${label}: ${formatMoney(f.totalMinor)} for ${n} ${n === 1 ? "employee" : "employees"}.`);
  }
  if (f.underBudgetByMinor >= 0) parts.push(`This is ${formatMoney(f.underBudgetByMinor)} below the ${formatMoney(f.totalBudgetMinor)} total budget.`);
  else parts.push(`This exceeds the ${formatMoney(f.totalBudgetMinor)} total budget by ${formatMoney(-f.underBudgetByMinor)} and cannot be purchased.`);
  if (f.savingsMinor > 0) parts.push(`It saves ${formatMoney(f.savingsMinor)} against the median-fare baseline of ${formatMoney(f.baselineMinor)}.`);
  if (f.arriveBy && f.latestArrival) parts.push(`Every routed traveler lands by ${f.latestArrival}, before the ${f.arriveBy} deadline.`);
  const top = f.outboundGroups[0];
  if (top && n > 1) {
    const rest = f.assignedCount - top.count;
    parts.push(
      rest > 0
        ? `${top.count} travelers share ${top.flight} (${top.departTime}); ${rest} ${rest === 1 ? "is" : "are"} on ${f.outboundGroups.length - 1} other flight${f.outboundGroups.length > 2 ? "s" : ""} because of seat availability, baggage or personal departure constraints.`
        : `All travelers share outbound flight ${top.flight} (${top.departTime}).`,
    );
  }
  if (f.arrivalSpreadMin > 0 && n > 1) parts.push(`Arrival times differ by at most ${f.arrivalSpreadMin} minutes.`);
  for (const e of f.exceptions) {
    parts.push(
      e.overMinor > 0
        ? `Exception: ${e.name} costs ${formatMoney(e.priceMinor)}, ${formatMoney(e.overMinor)} over the ${formatMoney(e.limitMinor)} limit — approval required.`
        : `Note for ${e.name}: ${e.reason}`,
    );
  }
  if (!f.exceptions.length && !f.unsatisfied.length) parts.push("All itineraries comply with company travel policy.");
  return parts.join(" ");
}

/** All numeric tokens a generated explanation is allowed to contain. */
export function allowedNumbers(f: PlanFacts): Set<string> {
  const s = new Set<string>();
  const addMoney = (m: number) => {
    s.add(String(Math.round(Math.abs(m) / 100)));
    s.add(String(Math.abs(m) / 100));
  };
  [f.totalMinor, f.totalBudgetMinor, f.underBudgetByMinor, f.baselineMinor, f.savingsMinor].forEach(addMoney);
  f.exceptions.forEach((e) => [e.priceMinor, e.limitMinor, e.overMinor].forEach(addMoney));
  [f.travelerCount, f.assignedCount, f.arrivalSpreadMin, f.unsatisfied.length, f.exceptions.length, f.outboundGroups.length, f.returnGroups.length].forEach((x) => s.add(String(x)));
  f.outboundGroups.concat(f.returnGroups).forEach((g) => {
    s.add(String(g.count));
    g.flight.split(" ").forEach((p) => s.add(p.replace(/\D/g, "")));
    g.departTime.split(":").forEach((p) => s.add(String(parseInt(p, 10))).add(p));
  });
  [f.arriveBy, f.latestArrival].forEach((t) => t?.split(":").forEach((p) => s.add(String(parseInt(p, 10))).add(p)));
  if (f.assignedCount > 0) s.add(String(f.travelerCount - f.assignedCount));
  const top = f.outboundGroups[0];
  if (top) s.add(String(f.assignedCount - top.count));
  return s;
}

/** Reject any generated text containing a number that is not derived from the plan data. */
export function numbersAreGrounded(text: string, f: PlanFacts): boolean {
  const allowed = allowedNumbers(f);
  const tokens = text.replace(/(\d),(\d)/g, "$1$2").match(/\d+(?:\.\d+)?/g) ?? [];
  return tokens.every((t) => allowed.has(t) || allowed.has(String(parseFloat(t))));
}
