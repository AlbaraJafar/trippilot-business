import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handler } from "@/lib/api";
import { decideApproval } from "@/lib/services/requests";

export const POST = handler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser(["TRAVEL_MANAGER", "DEPARTMENT_HEAD", "ADMIN"]);
  const { decision, note } = z
    .object({ decision: z.enum(["APPROVED", "REJECTED", "CHANGES_REQUESTED"]), note: z.string().max(500).default("") })
    .parse(await req.json());
  await decideApproval(user, (await ctx.params).id, decision, note);
  return NextResponse.json({ ok: true });
});
