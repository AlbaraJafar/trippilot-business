import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handler } from "@/lib/api";
import { searchFlightsForRequest } from "@/lib/services/requests";

export const POST = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser(["TRAVEL_MANAGER", "ADMIN"]);
  return NextResponse.json(await searchFlightsForRequest(user, (await ctx.params).id));
});
