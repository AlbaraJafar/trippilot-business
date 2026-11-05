import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handler } from "@/lib/api";
import { capturePayment } from "@/lib/services/payments";

export const POST = handler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser(["TRAVEL_MANAGER", "ADMIN"]);
  const { orderId } = z.object({ orderId: z.string().min(5).max(64) }).parse(await req.json());
  return NextResponse.json(await capturePayment(user, (await ctx.params).id, orderId));
});
