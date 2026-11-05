import { formatMoney } from "../money";
import type { PolicyFinding, PolicyStatus, ScoringWeights } from "./types";
import { LEVEL_LABEL } from "./types";

/**
 * Deterministic corporate travel policy engine.
 * The LLM never calls into or overrides anything in this file.
 */

export interface PolicyConfig {
  standardMaxMinor: number;
  seniorMaxMinor: number;
  executiveMaxMinor: number;
  allowedCabins: string[];
  preferredAirlines: string[];
  directPreferred: boolean;
  minAdvanceDays: number;
  maxTripBudgetMinor: number;
  managerApprovalMaxMinor: number;
  deptHeadApprovalMaxMinor: number;
  groupDeptHeadMinor: number;
  autoExecuteMaxMinor: number;
  weights: ScoringWeights;
}

export interface PolicyTraveler {
  employeeId: string;
  name: string;
  grade: string;
  budgetLimitMinor: number;
}

export interface PolicyFlight {
  flightNumber: string;
  airline: string;
  cabin: string;
  stops: number;
  date: string;
  priceMinor: number;
}

export function gradeLimit(policy: PolicyConfig, grade: string): number {
  if (grade === "EXECUTIVE") return policy.executiveMaxMinor;
  if (grade === "SENIOR") return policy.seniorMaxMinor;
  return policy.standardMaxMinor;
}

/** The binding per-trip limit: the stricter of the grade limit and the employee's personal limit. */
export function effectiveLimit(policy: PolicyConfig, t: PolicyTraveler): number {
  return Math.min(gradeLimit(policy, t.grade), t.budgetLimitMinor);
}

export function cabinAllowed(policy: PolicyConfig, cabin: string): boolean {
  return policy.allowedCabins.includes(cabin);
}

function daysBetween(fromISO: string, toISO: string): number {
  return Math.round((Date.parse(`${toISO}T00:00:00Z`) - Date.parse(`${fromISO}T00:00:00Z`)) / 86400000);
}

export function statusFromFindings(findings: PolicyFinding[]): PolicyStatus {
  if (findings.some((f) => f.severity === "VIOLATION")) return "POLICY_VIOLATION";
  if (findings.some((f) => f.severity === "REQUIRES_APPROVAL")) return "REQUIRES_APPROVAL";
  return "COMPLIANT";
}

/** Evaluate one traveler's round trip against company policy. */
export function evaluateTravelerTrip(
  policy: PolicyConfig,
  traveler: PolicyTraveler,
  flights: PolicyFlight[],
  todayISO: string,
  alternatives?: { cheapestCompliantMinor?: number },
): { status: PolicyStatus; findings: PolicyFinding[] } {
  const findings: PolicyFinding[] = [];
  const total = flights.reduce((a, f) => a + f.priceMinor, 0);
  const limit = effectiveLimit(policy, traveler);
  const first = traveler.name.split(" ")[0];

  for (const f of flights) {
    if (!cabinAllowed(policy, f.cabin)) {
      findings.push({
        rule: "ALLOWED_CABIN",
        severity: "VIOLATION",
        message: `${f.flightNumber} is ${f.cabin.toLowerCase()} class, which is not permitted for ${first}.`,
        actual: f.cabin,
        allowed: policy.allowedCabins.join(", "),
        recommendation: "Choose an economy fare on the same route.",
      });
    }
    if (policy.directPreferred && f.stops > 0) {
      findings.push({
        rule: "DIRECT_PREFERRED",
        severity: "INFO",
        message: `${f.flightNumber} has ${f.stops} stop(s); company prefers direct flights.`,
        actual: `${f.stops} stop(s)`,
        allowed: "Direct",
      });
    }
    if (policy.preferredAirlines.length && !policy.preferredAirlines.includes(f.airline)) {
      findings.push({
        rule: "PREFERRED_AIRLINE",
        severity: "INFO",
        message: `${f.flightNumber} is not on a preferred airline (${policy.preferredAirlines.join(", ")}).`,
      });
    }
  }

  const outbound = flights[0];
  if (outbound) {
    const advance = daysBetween(todayISO, outbound.date);
    if (advance < policy.minAdvanceDays) {
      findings.push({
        rule: "MIN_ADVANCE_BOOKING",
        severity: "REQUIRES_APPROVAL",
        message: `Booked ${advance} day(s) before departure; policy requires ${policy.minAdvanceDays}.`,
        actual: `${advance} days`,
        allowed: `≥ ${policy.minAdvanceDays} days`,
        recommendation: "Approve as a late booking or move the trip date.",
      });
    }
  }

  if (total > limit) {
    const over = total - limit;
    const approver = total > policy.deptHeadApprovalMaxMinor ? LEVEL_LABEL[3] : LEVEL_LABEL[2];
    findings.push({
      rule: "TRIP_BUDGET_LIMIT",
      severity: "REQUIRES_APPROVAL",
      message: `${traveler.name}'s itinerary costs ${formatMoney(total)}, exceeding the ${formatMoney(limit)} limit by ${formatMoney(over)}. ${approver} approval is required.`,
      actual: formatMoney(total),
      allowed: formatMoney(limit),
      recommendation:
        alternatives?.cheapestCompliantMinor !== undefined
          ? `Cheapest itinerary meeting ${first}'s travel constraints is ${formatMoney(alternatives.cheapestCompliantMinor)}.`
          : "Relax the departure constraint or approve the exception.",
    });
  }

  return { status: statusFromFindings(findings), findings };
}

export interface ApprovalRequirement {
  level: number; // 1..3
  reasons: string[];
  autoExecutable: boolean;
}

/** Payment approval routing — which authority must sign off before money moves. */
export function requiredApproval(
  policy: PolicyConfig,
  perEmployee: { name: string; priceMinor: number }[],
  totalMinor: number,
  deptRemainingMinor: number,
): ApprovalRequirement {
  let level = 1;
  const reasons: string[] = [];
  for (const e of perEmployee) {
    if (e.priceMinor > policy.deptHeadApprovalMaxMinor) {
      level = Math.max(level, 3);
      reasons.push(`${e.name}: ${formatMoney(e.priceMinor)} exceeds ${formatMoney(policy.deptHeadApprovalMaxMinor)} per employee → executive approval.`);
    } else if (e.priceMinor > policy.managerApprovalMaxMinor) {
      level = Math.max(level, 2);
      reasons.push(`${e.name}: ${formatMoney(e.priceMinor)} exceeds ${formatMoney(policy.managerApprovalMaxMinor)} per employee → department head approval.`);
    }
  }
  if (totalMinor > policy.groupDeptHeadMinor) {
    level = Math.max(level, 2);
    reasons.push(`Total purchase ${formatMoney(totalMinor)} exceeds the ${formatMoney(policy.groupDeptHeadMinor)} group threshold → department head approval.`);
  }
  if (totalMinor > deptRemainingMinor) {
    level = 3;
    reasons.push(`Total ${formatMoney(totalMinor)} exceeds the department's remaining budget of ${formatMoney(deptRemainingMinor)} → escalated to executive.`);
  }
  if (level === 1) reasons.push(`All tickets are within ${formatMoney(policy.managerApprovalMaxMinor)} per employee — the travel manager may approve.`);
  const autoExecutable = level === 1 && policy.autoExecuteMaxMinor > 0 && totalMinor <= policy.autoExecuteMaxMinor;
  return { level, reasons, autoExecutable };
}
