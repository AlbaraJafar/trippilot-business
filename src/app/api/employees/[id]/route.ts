import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handler } from "@/lib/api";
import { updateEmployee } from "@/lib/services/employees";

export const PATCH = handler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser(["ADMIN"]);
  const e = await updateEmployee(user, (await ctx.params).id, await req.json());
  return NextResponse.json({ id: e.id, active: e.active });
});
// POST alias so the generic ActionButton can toggle activation
export const POST = PATCH;
