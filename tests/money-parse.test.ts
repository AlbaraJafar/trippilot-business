import { describe, expect, it } from "vitest";
import { formatMoney, parseMoney, sarToUsdCents, toDecimalString } from "@/lib/money";
import { parseInstructionDeterministic } from "@/lib/ai/parse-deterministic";
import { numbersAreGrounded } from "@/lib/ai/explain";
import { travelRequirementsSchema } from "@/lib/domain/types";

describe("money", () => {
  it("parses and formats without floating point", () => {
    expect(parseMoney("1,200.50")).toBe(120050);
    expect(parseMoney("SAR 15000")).toBe(1500000);
    expect(() => parseMoney("12.345")).toThrow();
    expect(formatMoney(1085000)).toBe("SAR 10,850");
    expect(formatMoney(123456, "USD", { decimals: true })).toBe("USD 1,234.56");
    expect(toDecimalString(5)).toBe("0.05");
  });
  it("converts SAR to USD at the 3.75 peg with half-up rounding", () => {
    expect(sarToUsdCents(37500)).toBe(10000); // SAR 375 = USD 100
    expect(sarToUsdCents(100)).toBe(27); // 26.67 -> 27
    expect(sarToUsdCents(950500)).toBe(253467);
  });
});

describe("deterministic NL parser", () => {
  it("extracts the flagship demo instruction", () => {
    const { requirements: r } = parseInstructionDeterministic(
      "Arrange a trip for 10 employees from Riyadh to Jeddah on March 15. They need to arrive before 10 AM and return after 5 PM on March 16. Keep the total below SAR 15,000. Direct flights only.",
      "2026-11-04",
      { maxPerEmployeeSar: 1200 },
    );
    expect(r.origin).toBe("RUH");
    expect(r.destination).toBe("JED");
    expect(r.travelerCount).toBe(10);
    expect(r.outboundDates).toEqual(["2027-03-15"]);
    expect(r.returnDates).toEqual(["2027-03-16"]);
    expect(r.arriveBy).toBe("10:00");
    expect(r.returnDepartAfter).toBe("17:00");
    expect(r.totalBudgetSar).toBe(15000);
    expect(r.maxPerEmployeeSar).toBe(1500);
    expect(r.directOnly).toBe(true);
    expect(travelRequirementsSchema.safeParse(r).success).toBe(true);
  });

  it("extracts per-employee budgets and cheapest objective", () => {
    const { requirements: r } = parseInstructionDeterministic(
      "Find the cheapest flights for 4 engineers from Jeddah to Madinah on 2 April, back on 3 April evening. Do not exceed SAR 1,200 per employee. Checked bags needed.",
      "2026-11-04",
      { maxPerEmployeeSar: 1200 },
    );
    expect([r.origin, r.destination]).toEqual(["JED", "MED"]);
    expect(r.maxPerEmployeeSar).toBe(1200);
    expect(r.totalBudgetSar).toBe(4800);
    expect(r.baggage).toBe("CHECKED");
    expect(r.objective).toBe("LOWEST_GROUP_COST");
    expect(r.returnDepartAfter).toBe("17:00");
    expect(r.outboundDates).toEqual(["2027-04-02"]);
  });
});

describe("explanation grounding", () => {
  const facts = {
    strategy: "BALANCED" as const, travelerCount: 10, assignedCount: 10, totalMinor: 950500, totalBudgetMinor: 1500000,
    underBudgetByMinor: 549500, baselineMinor: 1080000, savingsMinor: 129500, arriveBy: "10:00", latestArrival: "08:25",
    arrivalSpreadMin: 90, outboundGroups: [{ flight: "F3 106", departTime: "06:30", count: 5 }], returnGroups: [],
    exceptions: [], unsatisfied: [], avgScore: 700,
  };
  it("accepts grounded numbers and rejects invented ones", () => {
    expect(numbersAreGrounded("Plan costs SAR 9,505 for 10 employees, saving SAR 1,295.", facts)).toBe(true);
    expect(numbersAreGrounded("Plan costs SAR 9,999 for 10 employees.", facts)).toBe(false);
  });
});
