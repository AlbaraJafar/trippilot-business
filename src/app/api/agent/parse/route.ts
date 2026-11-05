import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { audit, handler } from "@/lib/api";
import { parseInstruction } from "@/lib/ai";
import { loadPolicy, todayISO } from "@/lib/policy-store";
import { prisma } from "@/lib/db";

export const POST = handler(async (req: Request) => {
  const user = await requireUser(["TRAVEL_MANAGER", "ADMIN"]);
  const { text } = z.object({ text: z.string().trim().min(10).max(2000) }).parse(await req.json());
  const { config } = await loadPolicy(user.companyId);
  const parsed = await parseInstruction(text, todayISO(), { maxPerEmployeeSar: config.standardMaxMinor / 100 });

  // Suggested travelers: active staff who are not on the leadership / travel-desk demo accounts.
  const employees = await prisma.employee.findMany({
    where: { companyId: user.companyId, active: true, OR: [{ user: null }, { user: { role: "EMPLOYEE" } }] },
    orderBy: [{ employeeCode: "asc" }],
  });
  const suggested = employees.slice(0, parsed.requirements.travelerCount).map((e) => e.id);
  await audit(user.companyId, user, "AI_INSTRUCTION_PARSED", "Agent", "parse", { engine: parsed.engine, warnings: parsed.warnings.length });
  return NextResponse.json({ ...parsed, suggestedEmployeeIds: suggested });
});
