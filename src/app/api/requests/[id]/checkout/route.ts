import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handler } from "@/lib/api";
import { createCheckout, previewCheckout } from "@/lib/services/payments";

export const GET = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  return NextResponse.json(await previewCheckout(user, (await ctx.params).id));
});

export const POST = handler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser(["TRAVEL_MANAGER", "ADMIN"]);
  const consent = z.object({ accepted: z.literal(true), amountMinor: z.number().int().positive() }).parse(await req.json());
  return NextResponse.json(await createCheckout(user, (await ctx.params).id, consent));
});
