import { describe, expect, it } from "vitest";
import { DemoFlightProvider } from "@/lib/providers/demo";
import { flightRejections, optimize, recommend, type OptFlight, type OptRequest, type OptTraveler } from "@/lib/domain/optimizer";
import { requiredApproval, type PolicyConfig } from "@/lib/domain/policy";
import { DEFAULT_WEIGHTS } from "@/lib/domain/types";

const policy: PolicyConfig = {
  standardMaxMinor: 120000,
  seniorMaxMinor: 200000,
  executiveMaxMinor: 500000,
  allowedCabins: ["ECONOMY"],
  preferredAirlines: [],
  directPreferred: true,
  minAdvanceDays: 3,
  maxTripBudgetMinor: 5000000,
  managerApprovalMaxMinor: 120000,
  deptHeadApprovalMaxMinor: 200000,
  groupDeptHeadMinor: 1000000,
  autoExecuteMaxMinor: 0,
  weights: DEFAULT_WEIGHTS,
};

const request: OptRequest = {
  outboundDates: ["2027-03-15"],
  returnDates: ["2027-03-16"],
  arriveBy: "10:00",
  earliestDeparture: null,
  returnDepartAfter: "17:00",
  latestReturn: "23:59",
  maxPerEmployeeMinor: 120000,
  totalBudgetMinor: 1500000,
  preferredAirlines: [],
  baggage: "ANY",
  directOnly: true,
};

const t = (id: string, baggage: string, earliest: string | null = null): OptTraveler => ({
  employeeId: id,
  name: `${id} Test`,
  grade: "STANDARD",
  budgetLimitMinor: 120000,
  preferredAirline: null,
  preferredDeparture: "ANY",
  earliestDeparture: earliest,
  baggage,
});

const team = [
  t("A", "CHECKED"), t("B", "CABIN"), t("K", "CHECKED", "07:00"), t("D", "CABIN"), t("E", "CHECKED"),
  t("F", "CABIN"), t("G", "CHECKED"), t("H", "CHECKED"), t("I", "CABIN"), t("J", "CHECKED"),
];

async function demoFlights(): Promise<OptFlight[]> {
  const p = new DemoFlightProvider();
  const outs = await p.searchFlights({ origin: "RUH", destination: "JED", dates: ["2027-03-15"], passengers: 10 });
  const rets = await p.searchFlights({ origin: "JED", destination: "RUH", dates: ["2027-03-16"], passengers: 10 });
  return [
    ...outs.map((f) => ({ ...f, id: f.providerRef, direction: "OUTBOUND" as const })),
    ...rets.map((f) => ({ ...f, id: f.providerRef, direction: "RETURN" as const })),
  ];
}

describe("hard constraints", () => {
  it("rejects late arrivals, non-direct, early returns and disallowed cabins", async () => {
    const flights = await demoFlights();
    const byNo = (n: string) => flights.find((f) => f.flightNumber === n)!;
    expect(flightRejections(byNo("XY 2014"), request, policy).join()).toMatch(/Arrives after 10:00/);
    expect(flightRejections(byNo("SV 1301"), request, policy).join()).toMatch(/Not direct/);
    expect(flightRejections(byNo("XY 2027"), request, policy).join()).toMatch(/Departs before 17:00/);
    expect(flightRejections(byNo("SV 1001"), request, policy).join()).toMatch(/BUSINESS cabin/);
    expect(flightRejections(byNo("SV 1047"), request, policy).join()).toMatch(/Lands after 23:59/);
    expect(flightRejections(byNo("F3 106"), request, policy)).toEqual([]);
  });

  it("never assigns a flight that violates a hard constraint", async () => {
    const flights = await demoFlights();
    const plans = optimize(team, flights, request, policy, "2026-11-04");
    const byId = new Map(flights.map((f) => [f.id, f]));
    for (const p of plans) {
      for (const a of p.assignments) {
        const out = byId.get(a.outFlightId!)!;
        const ret = byId.get(a.retFlightId!)!;
        expect(out.arriveTime <= "10:00").toBe(true);
        expect(out.stops).toBe(0);
        expect(ret.departTime >= "17:00").toBe(true);
        expect(out.cabin).toBe("ECONOMY");
        const tr = team.find((x) => x.employeeId === a.employeeId)!;
        if (tr.baggage === "CHECKED") {
          expect(out.baggage).toBe("CHECKED");
          expect(ret.baggage).toBe("CHECKED");
        }
        if (tr.earliestDeparture) expect(out.departTime >= tr.earliestDeparture).toBe(true);
      }
    }
  });

  it("respects seat capacity", async () => {
    const flights = await demoFlights();
    const plans = optimize(team, flights, request, policy, "2026-11-04");
    for (const p of plans) {
      const used = new Map<string, number>();
      for (const a of p.assignments) for (const id of [a.outFlightId!, a.retFlightId!]) used.set(id, (used.get(id) ?? 0) + 1);
      for (const [id, n] of used) expect(n).toBeLessThanOrEqual(flights.find((f) => f.id === id)!.seatsLeft);
    }
  });
});

describe("group optimisation", () => {
  it("produces three feasible plans, cheapest is cheapest, and flags Khalid-style exception", async () => {
    const flights = await demoFlights();
    const plans = optimize(team, flights, request, policy, "2026-11-04");
    expect(plans.map((p) => p.strategy)).toEqual(["CHEAPEST", "BALANCED", "CONVENIENT"]);
    expect(plans.every((p) => p.feasible)).toBe(true);
    const [cheap, bal, conv] = plans;
    expect(cheap.totalMinor).toBeLessThanOrEqual(bal.totalMinor);
    expect(cheap.totalMinor).toBeLessThanOrEqual(conv.totalMinor);
    expect(cheap.totalMinor).toBeLessThan(request.totalBudgetMinor);
    const k = cheap.assignments.find((a) => a.employeeId === "K")!;
    expect(k.budgetException).toBe(true);
    expect(k.policyStatus).toBe("REQUIRES_APPROVAL");
    expect(cheap.policyStatus).toBe("REQUIRES_APPROVAL");
    expect(cheap.facts.savingsMinor).toBeGreaterThan(0);
    expect(recommend(plans)).toBe("BALANCED");
  });

  it("marks travelers with no compatible flights as unsatisfied and the plan infeasible", async () => {
    const flights = await demoFlights();
    const plans = optimize([t("Z", "CHECKED", "09:00")], flights, request, policy, "2026-11-04");
    expect(plans[0].feasible).toBe(false);
    expect(plans[0].assignments[0].unsatisfiedReason).toMatch(/No outbound flight/);
  });

  it("over-budget totals make the plan infeasible", async () => {
    const flights = await demoFlights();
    const plans = optimize(team, flights, { ...request, totalBudgetMinor: 500000 }, policy, "2026-11-04");
    expect(plans.every((p) => !p.feasible)).toBe(true);
  });
});

describe("approval routing", () => {
  it("routes by per-employee and group thresholds", () => {
    expect(requiredApproval(policy, [{ name: "a", priceMinor: 100000 }], 100000, 1e9).level).toBe(1);
    expect(requiredApproval(policy, [{ name: "a", priceMinor: 125000 }], 125000, 1e9).level).toBe(2);
    expect(requiredApproval(policy, [{ name: "a", priceMinor: 250000 }], 250000, 1e9).level).toBe(3);
    expect(requiredApproval(policy, [{ name: "a", priceMinor: 100000 }], 1100000, 1e9).level).toBe(2);
    expect(requiredApproval(policy, [{ name: "a", priceMinor: 100000 }], 100000, 50000).level).toBe(3);
  });
});
