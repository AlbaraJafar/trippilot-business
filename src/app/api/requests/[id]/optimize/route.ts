import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handler } from "@/lib/api";
import { optimizeRequest, searchFlightsForRequest } from "@/lib/services/requests";
import { prisma } from "@/lib/db";

export const POST = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser(["TRAVEL_MANAGER", "ADMIN"]);
  const id = (await ctx.params).id;
  if ((await prisma.flightOption.count({ where: { requestId: id } })) === 0) await searchFlightsForRequest(user, id);
  return NextResponse.json(await optimizeRequest(user, id));
});
