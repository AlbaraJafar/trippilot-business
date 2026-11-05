import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { audit, handler } from "@/lib/api";
import { prisma } from "@/lib/db";
import { scoringWeightsSchema } from "@/lib/domain/types";
import { sar } from "@/lib/money";

const sarInt = z.number().int().min(0).max(10_000_000);
const schema = z
  .object({
    standardMaxSar: sarInt,
    seniorMaxSar: sarInt,
    executiveMaxSar: sarInt,
    allowedCabins: z.array(z.enum(["ECONOMY", "PREMIUM", "BUSINESS"])).min(1),
    preferredAirlines: z.array(z.string().regex(/^[A-Z0-9]{2}$/)).max(10),
    directPreferred: z.boolean(),
    minAdvanceDays: z.number().int().min(0).max(90),
    maxTripBudgetSar: sarInt,
    managerApprovalMaxSar: sarInt,
    deptHeadApprovalMaxSar: sarInt,
    groupDeptHeadSar: sarInt,
    autoExecuteMaxSar: sarInt,
    weights: scoringWeightsSchema,
  })
  .refine((p) => p.managerApprovalMaxSar <= p.deptHeadApprovalMaxSar, { message: "Travel-manager threshold must not exceed department-head threshold", path: ["managerApprovalMaxSar"] })
  .refine((p) => Object.values(p.weights).reduce((a, b) => a + b, 0) > 0, { message: "At least one scoring weight must be positive", path: ["weights"] });

export const POST = handler(async (req: Request) => {
  const user = await requireUser(["ADMIN"]);
  const p = schema.parse(await req.json());
  await prisma.travelPolicy.update({
    where: { companyId: user.companyId },
    data: {
      standardMaxMinor: sar(p.standardMaxSar),
      seniorMaxMinor: sar(p.seniorMaxSar),
      executiveMaxMinor: sar(p.executiveMaxSar),
      allowedCabins: p.allowedCabins.join(","),
      preferredAirlines: p.preferredAirlines.join(","),
      directPreferred: p.directPreferred,
      minAdvanceDays: p.minAdvanceDays,
      maxTripBudgetMinor: sar(p.maxTripBudgetSar),
      managerApprovalMaxMinor: sar(p.managerApprovalMaxSar),
      deptHeadApprovalMaxMinor: sar(p.deptHeadApprovalMaxSar),
      groupDeptHeadMinor: sar(p.groupDeptHeadSar),
      autoExecuteMaxMinor: sar(p.autoExecuteMaxSar),
      scoringWeights: JSON.stringify(p.weights),
    },
  });
  await audit(user.companyId, user, "POLICY_UPDATED", "TravelPolicy", user.companyId, p);
  return NextResponse.json({ ok: true });
});
