import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyWebhook } from "@/lib/payments/paypal";
import { reconcilePaymentById } from "@/lib/services/payments";

/**
 * PayPal webhook receiver. Events are acted upon only after the PayPal
 * verify-webhook-signature API confirms them (requires PAYPAL_WEBHOOK_ID).
 * Capture success is established by the verified capture flow; webhooks record
 * events and handle pending-capture completion, denials, reversals and refunds.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  let verified = false;
  try {
    verified = await verifyWebhook(req.headers, raw);
  } catch {
    verified = false;
  }
  if (!verified) return NextResponse.json({ error: "Webhook signature not verified" }, { status: 400 });

  const evt = JSON.parse(raw) as {
    id: string;
    event_type: string;
    resource?: { id?: string; status?: string; supplementary_data?: { related_ids?: { order_id?: string } } };
  };
  const orderId =
    evt.resource?.supplementary_data?.related_ids?.order_id ?? (evt.event_type.startsWith("CHECKOUT.ORDER") ? evt.resource?.id : undefined);
  const payment =
    (orderId ? await prisma.payment.findUnique({ where: { paypalOrderId: orderId } }) : null) ??
    (evt.resource?.id ? await prisma.payment.findUnique({ where: { paypalCaptureId: evt.resource.id } }) : null);
  if (!payment) return NextResponse.json({ ok: true, ignored: true });

  await prisma.paymentEvent.create({
    data: {
      paymentId: payment.id,
      type: `WEBHOOK_${evt.event_type}`,
      message: `Verified webhook ${evt.id} (${evt.event_type}).`,
      payload: JSON.stringify({ id: evt.id, type: evt.event_type, status: evt.resource?.status }),
    },
  });
  const captureOutcome = ["PAYMENT.CAPTURE.COMPLETED", "PAYMENT.CAPTURE.DENIED", "PAYMENT.CAPTURE.PENDING"].includes(evt.event_type);
  if (captureOutcome && ["CAPTURE_PENDING", "CAPTURE_UNKNOWN", "CAPTURING"].includes(payment.status)) {
    // Never trust the event body for money state: re-read the order from PayPal and verify it.
    try {
      await reconcilePaymentById(payment.id);
    } catch {
      return NextResponse.json({ error: "Reconciliation failed; PayPal will retry" }, { status: 503 });
    }
  } else if (evt.event_type === "PAYMENT.CAPTURE.REVERSED") {
    await prisma.payment.update({ where: { id: payment.id }, data: { status: "FAILED", errorMessage: `PayPal event ${evt.event_type}` } });
  } else if (evt.event_type === "PAYMENT.CAPTURE.REFUNDED" && payment.status !== "REFUNDED") {
    await prisma.payment.update({ where: { id: payment.id }, data: { status: "REFUNDED", refundedAt: new Date() } });
  }
  return NextResponse.json({ ok: true });
}
