import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handler } from "@/lib/api";
import { cancelCheckout } from "@/lib/services/payments";

export const POST = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser(["TRAVEL_MANAGER", "ADMIN"]);
  await cancelCheckout(user, (await ctx.params).id);
  return NextResponse.json({ ok: true });
});
