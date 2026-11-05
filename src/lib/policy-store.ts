import "server-only";
import type { TravelPolicy } from "@prisma/client";
import { prisma } from "./db";
import type { PolicyConfig } from "./domain/policy";
import { DEFAULT_WEIGHTS, scoringWeightsSchema } from "./domain/types";

export function toPolicyConfig(p: TravelPolicy): PolicyConfig {
  let weights = DEFAULT_WEIGHTS;
  try {
    weights = scoringWeightsSchema.parse(JSON.parse(p.scoringWeights));
  } catch {
    /* keep defaults */
  }
  return {
    standardMaxMinor: p.standardMaxMinor,
    seniorMaxMinor: p.seniorMaxMinor,
    executiveMaxMinor: p.executiveMaxMinor,
    allowedCabins: p.allowedCabins.split(",").map((s) => s.trim()).filter(Boolean),
    preferredAirlines: p.preferredAirlines.split(",").map((s) => s.trim()).filter(Boolean),
    directPreferred: p.directPreferred,
    minAdvanceDays: p.minAdvanceDays,
    maxTripBudgetMinor: p.maxTripBudgetMinor,
    managerApprovalMaxMinor: p.managerApprovalMaxMinor,
    deptHeadApprovalMaxMinor: p.deptHeadApprovalMaxMinor,
    groupDeptHeadMinor: p.groupDeptHeadMinor,
    autoExecuteMaxMinor: p.autoExecuteMaxMinor,
    weights,
  };
}

export async function loadPolicy(companyId: string) {
  const p = await prisma.travelPolicy.findUniqueOrThrow({ where: { companyId } });
  return { row: p, config: toPolicyConfig(p) };
}

/** Department budget remaining = annual budget − captured spend (net of refunds). */
export async function departmentRemaining(departmentId: string): Promise<{ budgetMinor: number; spentMinor: number; remainingMinor: number }> {
  const dept = await prisma.department.findUniqueOrThrow({ where: { id: departmentId } });
  const spent = await prisma.payment.aggregate({
    _sum: { amountMinor: true },
    where: { request: { departmentId }, status: { in: ["CAPTURED", "PARTIALLY_REFUNDED"] } },
  });
  const spentMinor = spent._sum.amountMinor ?? 0;
  return { budgetMinor: dept.budgetMinor, spentMinor, remainingMinor: dept.budgetMinor - spentMinor };
}

export function todayISO(): string {
  // Asia/Riyadh is UTC+3 with no DST
  return new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
}
