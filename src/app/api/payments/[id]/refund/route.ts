import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handler } from "@/lib/api";
import { refundPayment } from "@/lib/services/payments";

export const POST = handler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser(["ADMIN"]);
  const { reason } = z.object({ reason: z.string().trim().min(3).max(300) }).parse(await req.json());
  await refundPayment(user, (await ctx.params).id, reason);
  return NextResponse.json({ ok: true });
});
