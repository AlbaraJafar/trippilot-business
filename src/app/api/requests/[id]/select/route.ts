import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handler } from "@/lib/api";
import { selectItinerary } from "@/lib/services/requests";

export const POST = handler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser(["TRAVEL_MANAGER", "ADMIN"]);
  const { itineraryId } = z.object({ itineraryId: z.string().min(1) }).parse(await req.json());
  return NextResponse.json(await selectItinerary(user, (await ctx.params).id, itineraryId));
});
