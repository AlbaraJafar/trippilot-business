import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handler, notify } from "@/lib/api";
import { prisma } from "@/lib/db";
import { getProviderById } from "@/lib/providers";
import { formatMoney } from "@/lib/money";

/**
 * Re-price every active alert through its provider. For DEMO inventory the provider
 * returns a SIMULATED fare drift (clearly labelled) — not an airline fare.
 * Alerts only observe prices; they never change the price of an already-selected plan.
 */
export const POST = handler(async () => {
  const user = await requireUser(["TRAVEL_MANAGER", "ADMIN"]);
  const alerts = await prisma.priceAlert.findMany({ where: { status: "ACTIVE", request: { companyId: user.companyId } }, include: { flightOption: true } });
  let triggered = 0;
  for (const a of alerts) {
    const provider = getProviderById(a.flightOption.provider);
    const q = await provider.priceFlight(a.flightOption.providerRef, a.currentMinor);
    const history = JSON.parse(a.history) as { at: string; priceMinor: number }[];
    history.push({ at: q.quotedAt, priceMinor: q.priceMinor });
    const hit = q.priceMinor <= a.targetMinor;
    await prisma.priceAlert.update({
      where: { id: a.id },
      data: { currentMinor: q.priceMinor, history: JSON.stringify(history.slice(-30)), lastCheckedAt: new Date(), status: hit ? "TRIGGERED" : "ACTIVE" },
    });
    if (hit) {
      triggered++;
      await notify(user.companyId, {
        userId: a.createdById,
        kind: "PRICE",
        title: `Target fare reached: ${a.flightOption.flightNumber}${q.isSimulated ? " (simulated)" : ""}`,
        body: `${formatMoney(q.priceMinor)} ≤ target ${formatMoney(a.targetMinor)}${q.isSimulated ? " — demo inventory price simulation" : ""}`,
        link: `/requests/${a.requestId}`,
      });
    }
  }
  return NextResponse.json({ checked: alerts.length, triggered });
});
