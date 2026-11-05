import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handler } from "@/lib/api";
import { reconcilePayment } from "@/lib/services/payments";

/**
 * Reconcile a payment with PayPal (kept at /sync for API compatibility; /reconcile is an alias).
 * `status` remains PayPal's order status, as before; the reconciliation outcome is added alongside.
 */
export const POST = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser(["TRAVEL_MANAGER", "ADMIN"]);
  const r = await reconcilePayment(user, (await ctx.params).id);
  return NextResponse.json({ status: r.paypalOrderStatus, ...r });
});
