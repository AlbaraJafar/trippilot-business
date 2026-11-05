import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { audit, handler } from "@/lib/api";
import { prisma } from "@/lib/db";
import { HttpError } from "@/lib/auth";
import { sar } from "@/lib/money";

export const POST = handler(async (req: Request) => {
  const user = await requireUser(["TRAVEL_MANAGER", "ADMIN"]);
  const { flightOptionId, targetSar } = z.object({ flightOptionId: z.string().min(1), targetSar: z.number().int().min(1).max(100000) }).parse(await req.json());
  const f = await prisma.flightOption.findFirst({ where: { id: flightOptionId, request: { companyId: user.companyId } } });
  if (!f) throw new HttpError(404, "Flight not found.");
  const alert = await prisma.priceAlert.create({
    data: {
      requestId: f.requestId,
      flightOptionId: f.id,
      createdById: user.id,
      targetMinor: sar(targetSar),
      currentMinor: f.priceMinor,
      isSimulated: f.isDemo,
      history: JSON.stringify([{ at: new Date().toISOString(), priceMinor: f.priceMinor }]),
    },
  });
  await audit(user.companyId, user, "PRICE_ALERT_CREATED", "PriceAlert", alert.id, { flight: f.flightNumber, targetSar });
  return NextResponse.json({ id: alert.id });
});
