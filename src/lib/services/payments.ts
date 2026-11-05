import "server-only";
import type { Payment, User } from "@prisma/client";
import { prisma } from "../db";
import { audit, notify } from "../api";
import { HttpError } from "../auth";
import { FX_DESCRIPTION, formatMoney, sarToUsdCents, toDecimalString } from "../money";
import {
  approveLink,
  captureOrder,
  createOrder,
  getOrder,
  PayPalApiError,
  PayPalNotConfiguredError,
  paypalConfig,
  refundCapture,
  type PayPalOrder,
} from "../payments/paypal";
import { getProviderById } from "../providers";

/**
 * AI Payment & Approval Agent — server-side payment orchestration.
 * Amounts are ALWAYS recomputed from persisted itinerary records; the client never
 * supplies an amount, and the AI layer has no access to this module.
 */

const OPEN_STATUSES = ["CREATED", "PAYER_ACTION_REQUIRED", "CAPTURING"];

async function event(paymentId: string, type: string, message: string, payload?: unknown) {
  await prisma.paymentEvent.create({
    data: { paymentId, type, message, payload: payload ? JSON.stringify(payload).slice(0, 8000) : null },
  });
}

function appUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
}

/** Convert a SAR amount into the configured PayPal charge currency. */
export function chargeFor(halalas: number, currency: string): number {
  if (currency === "USD") return sarToUsdCents(halalas);
  throw new HttpError(500, `No FX conversion configured from SAR to ${currency}. Use PAYPAL_CHARGE_CURRENCY=USD.`);
}

export interface CheckoutPreview {
  requestId: string;
  itineraryId: string;
  amountMinor: number;
  chargeCurrency: string;
  chargeAmountMinor: number;
  fx: string;
  lines: { name: string; sarMinor: number; chargeMinor: number }[];
  paypalConfigured: boolean;
  sandbox: boolean;
  currencySupported: boolean;
}

/** Exact server-side amount for the approved plan. */
export async function previewCheckout(user: User, requestId: string): Promise<CheckoutPreview> {
  const req = await prisma.travelRequest.findFirst({ where: { id: requestId, companyId: user.companyId } });
  if (!req) throw new HttpError(404, "Request not found");
  if (!req.selectedItineraryId) throw new HttpError(409, "No plan has been selected.");
  const it = await prisma.itinerary.findUniqueOrThrow({
    where: { id: req.selectedItineraryId },
    include: { assignments: { include: { employee: true }, orderBy: { employee: { fullName: "asc" } } } },
  });
  const cfg = paypalConfig();
  const lines = it.assignments
    .filter((a) => a.outboundFlightId)
    .map((a) => ({
      name: a.employee.fullName,
      sarMinor: a.priceMinor,
      chargeMinor: cfg.currencySupported ? chargeFor(a.priceMinor, cfg.chargeCurrency) : 0,
    }));
  const amountMinor = lines.reduce((s, l) => s + l.sarMinor, 0);
  if (amountMinor !== it.totalMinor) throw new HttpError(409, "Itinerary total does not match its line items — re-run optimization.");
  return {
    requestId,
    itineraryId: it.id,
    amountMinor,
    chargeCurrency: cfg.chargeCurrency,
    chargeAmountMinor: lines.reduce((s, l) => s + l.chargeMinor, 0),
    fx: FX_DESCRIPTION,
    lines,
    paypalConfigured: cfg.configured,
    sandbox: cfg.isSandbox,
    currencySupported: cfg.currencySupported,
  };
}

/** Step 11: authorised payer gives explicit consent → server creates the PayPal order. */
export async function createCheckout(user: User, requestId: string, consent: { accepted: boolean; amountMinor: number }) {
  if (!["TRAVEL_MANAGER", "ADMIN"].includes(user.role)) throw new HttpError(403, "Only an authorised payer (travel manager or admin) can initiate payment.");
  if (!consent.accepted) throw new HttpError(400, "Explicit payment consent is required.");
  const cfg = paypalConfig();

  const req = await prisma.travelRequest.findFirst({ where: { id: requestId, companyId: user.companyId } });
  if (!req) throw new HttpError(404, "Request not found");
  if (!["APPROVED", "PAYMENT_PENDING"].includes(req.status)) throw new HttpError(409, `Request must be approved before payment (current status: ${req.status}).`);

  const approval = await prisma.approval.findFirst({
    where: { requestId, itineraryId: req.selectedItineraryId ?? "", status: "APPROVED" },
    orderBy: { decidedAt: "desc" },
  });
  if (!approval) throw new HttpError(409, "No approval found for the selected plan.");

  const preview = await previewCheckout(user, requestId);
  if (preview.amountMinor !== approval.amountMinor)
    throw new HttpError(409, `Amount changed since approval (${formatMoney(approval.amountMinor)} approved vs ${formatMoney(preview.amountMinor)} now). Re-submit for approval.`);
  if (consent.amountMinor !== preview.amountMinor) throw new HttpError(409, "The amount you consented to no longer matches the server amount. Review and try again.");

  const captured = await prisma.payment.findFirst({ where: { requestId, status: { in: ["CAPTURED", "CAPTURE_PENDING"] } } });
  if (captured) throw new HttpError(409, "This request has already been paid.");

  // Business rules are validated first; only then do we require a live PayPal configuration.
  if (!cfg.configured) throw new HttpError(503, new PayPalNotConfiguredError().message);
  if (!cfg.currencySupported) throw new HttpError(500, `PAYPAL_CHARGE_CURRENCY=${cfg.chargeCurrency} is not supported by PayPal REST APIs.`);

  // Duplicate protection: reuse an open order for the same itinerary + amount.
  const open = await prisma.payment.findFirst({
    where: { requestId, itineraryId: preview.itineraryId, amountMinor: preview.amountMinor, status: { in: ["CREATED", "PAYER_ACTION_REQUIRED"] }, approveUrl: { not: null } },
    orderBy: { createdAt: "desc" },
  });
  if (open) {
    await event(open.id, "CHECKOUT_REUSED", "Existing open PayPal order reused (duplicate attempt prevented).");
    return { paymentId: open.id, approveUrl: open.approveUrl!, reused: true };
  }

  const payment = await prisma.payment.create({
    data: {
      requestId,
      itineraryId: preview.itineraryId,
      source: cfg.isSandbox ? "PAYPAL_SANDBOX" : "PAYPAL_LIVE",
      amountMinor: preview.amountMinor,
      currency: "SAR",
      chargeAmountMinor: preview.chargeAmountMinor,
      chargeCurrency: cfg.chargeCurrency,
      fxRate: preview.fx,
      status: "CREATED",
      idempotencyKey: `tp-order-${crypto.randomUUID()}`,
      consentById: user.id,
      consentAt: new Date(),
    },
  });
  await event(payment.id, "CONSENT_RECORDED", `${user.name} authorised a charge of ${formatMoney(preview.chargeAmountMinor, cfg.chargeCurrency, { decimals: true })} (${formatMoney(preview.amountMinor)}).`);

  try {
    const order = await createOrder({
      requestId: payment.idempotencyKey,
      referenceId: payment.id,
      customId: req.code,
      invoiceId: `${req.code}-${payment.id.slice(-8)}`,
      description: `TripPilot ${req.code}: ${req.title}`,
      currency: cfg.chargeCurrency,
      value: toDecimalString(preview.chargeAmountMinor),
      items: preview.lines.map((l) => ({
        name: `Air travel – ${l.name}`.slice(0, 127),
        quantity: "1",
        unit_amount: { currency_code: cfg.chargeCurrency, value: toDecimalString(l.chargeMinor) },
        category: "DIGITAL_GOODS",
      })),
      returnUrl: `${appUrl()}/checkout/return?paymentId=${payment.id}`,
      cancelUrl: `${appUrl()}/checkout/return?paymentId=${payment.id}&cancelled=1`,
    });
    const url = approveLink(order);
    if (!url) throw new PayPalApiError(500, "NO_APPROVE_LINK", undefined, "PayPal did not return an approval link.");
    await prisma.payment.update({
      where: { id: payment.id },
      data: { paypalOrderId: order.id, status: "PAYER_ACTION_REQUIRED", approveUrl: url },
    });
    await event(payment.id, "ORDER_CREATED", `PayPal order ${order.id} created (status ${order.status}).`, { id: order.id, status: order.status });
    await prisma.travelRequest.update({ where: { id: requestId }, data: { status: "PAYMENT_PENDING" } });
    await audit(user.companyId, user, "PAYPAL_ORDER_CREATED", "Payment", payment.id, { orderId: order.id, amount: preview.amountMinor, charge: preview.chargeAmountMinor });
    return { paymentId: payment.id, approveUrl: url, reused: false };
  } catch (e) {
    const msg = e instanceof PayPalApiError ? `${e.message}${e.debugId ? ` (debug id ${e.debugId})` : ""}` : "Could not reach PayPal.";
    await prisma.payment.update({ where: { id: payment.id }, data: { status: "FAILED", errorMessage: msg } });
    await event(payment.id, "ORDER_CREATE_FAILED", msg);
    throw new HttpError(502, `PayPal order creation failed: ${msg}`);
  }
}

export function verifyCapture(payment: Payment, order: PayPalOrder): { ok: boolean; captureId?: string; status?: string; problem?: string } {
  const pu = order.purchase_units?.[0];
  const cap = pu?.payments?.captures?.[0];
  if (!cap) return { ok: false, problem: "No capture returned by PayPal." };
  if (pu?.reference_id && pu.reference_id !== payment.id) return { ok: false, captureId: cap.id, problem: "Reference id mismatch." };
  if (cap.amount.currency_code !== payment.chargeCurrency) return { ok: false, captureId: cap.id, problem: `Currency mismatch (${cap.amount.currency_code}).` };
  if (cap.amount.value !== toDecimalString(payment.chargeAmountMinor))
    return { ok: false, captureId: cap.id, problem: `Amount mismatch (${cap.amount.value} vs ${toDecimalString(payment.chargeAmountMinor)}).` };
  return { ok: true, captureId: cap.id, status: cap.status };
}

/** Step 12: capture after the payer approves on PayPal. Safe to call more than once. */
export async function capturePayment(user: User, paymentId: string, orderIdFromReturn: string) {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId }, include: { request: true } });
  if (!payment || payment.request.companyId !== user.companyId) throw new HttpError(404, "Payment not found.");
  if (!payment.paypalOrderId || payment.paypalOrderId !== orderIdFromReturn) throw new HttpError(400, "Order id does not match this payment.");
  if (payment.status === "CAPTURED" || payment.status === "CAPTURE_PENDING") return { status: payment.status, alreadyCaptured: true };
  if (!["PAYER_ACTION_REQUIRED", "CREATED"].includes(payment.status)) throw new HttpError(409, `Payment is ${payment.status}; cannot capture.`);

  // Optimistic lock prevents double capture from concurrent tabs / refreshes.
  const lock = await prisma.payment.updateMany({ where: { id: paymentId, status: { in: ["PAYER_ACTION_REQUIRED", "CREATED"] } }, data: { status: "CAPTURING" } });
  if (lock.count !== 1) return { status: "CAPTURING", alreadyCaptured: true };

  let order: PayPalOrder;
  try {
    order = await captureOrder(payment.paypalOrderId, `tp-capture-${payment.id}`);
  } catch (e) {
    if (e instanceof PayPalApiError && e.issue === "ORDER_ALREADY_CAPTURED") {
      order = await getOrder(payment.paypalOrderId);
    } else {
      const msg = e instanceof PayPalApiError ? `${e.issue ?? ""} ${e.message}`.trim() : "Could not reach PayPal.";
      const retryable = e instanceof PayPalApiError && ["ORDER_NOT_APPROVED", "INSTRUMENT_DECLINED", "PAYER_ACTION_REQUIRED"].includes(e.issue ?? "");
      await prisma.payment.update({ where: { id: paymentId }, data: { status: retryable ? "PAYER_ACTION_REQUIRED" : "FAILED", errorMessage: msg } });
      await event(paymentId, "CAPTURE_FAILED", msg);
      if (!retryable) await prisma.travelRequest.update({ where: { id: payment.requestId }, data: { status: "APPROVED" } });
      throw new HttpError(402, `Capture failed: ${msg}`);
    }
  }

  const v = verifyCapture(payment, order);
  if (!v.ok) {
    await prisma.payment.update({ where: { id: paymentId }, data: { status: "FAILED", paypalCaptureId: v.captureId ?? null, errorMessage: `Verification failed: ${v.problem} Manual review required.` } });
    await event(paymentId, "CAPTURE_VERIFICATION_FAILED", v.problem!, { orderStatus: order.status });
    throw new HttpError(502, `Payment verification failed: ${v.problem}`);
  }
  const status = v.status === "COMPLETED" ? "CAPTURED" : v.status === "PENDING" ? "CAPTURE_PENDING" : "FAILED";
  await prisma.payment.update({
    where: { id: paymentId },
    data: {
      status,
      paypalCaptureId: v.captureId,
      payerId: order.payer?.payer_id ?? null,
      payerEmail: order.payer?.email_address ?? null,
      capturedAt: status === "CAPTURED" ? new Date() : null,
      errorMessage: status === "FAILED" ? `Capture status ${v.status}` : null,
    },
  });
  await event(paymentId, "CAPTURE_COMPLETED", `Capture ${v.captureId} status ${v.status}; amount verified.`, { orderStatus: order.status, captureStatus: v.status });

  if (status === "CAPTURED" || status === "CAPTURE_PENDING") {
    await prisma.travelRequest.update({ where: { id: payment.requestId }, data: { status: "PAID" } });
    await createSimulatedHolds(payment.requestId);
    await audit(payment.request.companyId, user, "PAYMENT_CAPTURED", "Payment", paymentId, { captureId: v.captureId, amount: payment.amountMinor });
    await notify(payment.request.companyId, {
      kind: "PAYMENT",
      title: `PayPal payment captured · ${payment.request.code}`,
      body: `${formatMoney(payment.chargeAmountMinor, payment.chargeCurrency, { decimals: true })} (${formatMoney(payment.amountMinor)}) — Sandbox`,
      link: `/payments/${paymentId}`,
    });
  }
  return { status, alreadyCaptured: false };
}

export async function cancelCheckout(user: User, paymentId: string) {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId }, include: { request: true } });
  if (!payment || payment.request.companyId !== user.companyId) throw new HttpError(404, "Payment not found.");
  const res = await prisma.payment.updateMany({ where: { id: paymentId, status: { in: ["CREATED", "PAYER_ACTION_REQUIRED"] } }, data: { status: "CANCELLED" } });
  if (res.count) {
    await event(paymentId, "CHECKOUT_CANCELLED", "Payer cancelled on PayPal (order left uncaptured).");
    await prisma.travelRequest.update({ where: { id: payment.requestId }, data: { status: "APPROVED" } });
  }
}

/** Re-sync with PayPal (used by the transaction detail page). */
export async function syncPayment(user: User, paymentId: string) {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId }, include: { request: true } });
  if (!payment || payment.request.companyId !== user.companyId) throw new HttpError(404, "Payment not found.");
  if (!payment.paypalOrderId) throw new HttpError(409, "No PayPal order on this payment.");
  const order = await getOrder(payment.paypalOrderId);
  await event(paymentId, "ORDER_SYNCED", `PayPal reports order status ${order.status}.`, { status: order.status });
  return order.status;
}

export async function refundPayment(user: User, paymentId: string, reason: string) {
  if (user.role !== "ADMIN") throw new HttpError(403, "Only administrators can issue refunds.");
  const payment = await prisma.payment.findUnique({ where: { id: paymentId }, include: { request: true } });
  if (!payment || payment.request.companyId !== user.companyId) throw new HttpError(404, "Payment not found.");
  if (payment.status !== "CAPTURED" || !payment.paypalCaptureId) throw new HttpError(409, "Only captured PayPal payments can be refunded.");
  try {
    const r = await refundCapture(payment.paypalCaptureId, `tp-refund-${payment.id}`);
    await prisma.payment.update({ where: { id: paymentId }, data: { status: "REFUNDED", paypalRefundId: r.id, refundedAt: new Date() } });
    await event(paymentId, "REFUND_COMPLETED", `Refund ${r.id} status ${r.status}. Reason: ${reason}`);
    await prisma.travelRequest.update({ where: { id: payment.requestId }, data: { status: "REFUNDED" } });
    const provider = getProviderById("DEMO");
    const bookings = await prisma.booking.findMany({ where: { requestId: payment.requestId, status: { not: "CANCELLED" } } });
    for (const b of bookings) {
      if (b.isSimulated && b.reference) await provider.cancelBooking(b.reference);
      await prisma.booking.update({ where: { id: b.id }, data: { status: "CANCELLED" } });
    }
    await audit(user.companyId, user, "PAYMENT_REFUNDED", "Payment", paymentId, { refundId: r.id, reason });
  } catch (e) {
    if (e instanceof HttpError) throw e;
    const msg = e instanceof PayPalApiError ? e.message : "Could not reach PayPal.";
    await event(paymentId, "REFUND_FAILED", msg);
    throw new HttpError(502, `Refund failed: ${msg}`);
  }
}

/** Booking lifecycle — independent from payment. Demo inventory only produces SIMULATED holds. */
export async function createSimulatedHolds(requestId: string) {
  const req = await prisma.travelRequest.findUniqueOrThrow({ where: { id: requestId } });
  if (!req.selectedItineraryId) return;
  const existing = await prisma.booking.count({ where: { requestId, status: { not: "CANCELLED" } } });
  if (existing) return;
  const it = await prisma.itinerary.findUniqueOrThrow({
    where: { id: req.selectedItineraryId },
    include: { assignments: { include: { employee: true, outboundFlight: true } } },
  });
  for (const a of it.assignments.filter((x) => x.outboundFlight)) {
    const provider = getProviderById(a.outboundFlight!.provider);
    const isSim = !provider.isLive || !provider.capabilities.booking;
    if (!isSim) continue; // live booking not enabled in MVP
    const b = await provider.createBooking({ providerRef: a.outboundFlight!.providerRef, passengerName: a.employee.fullName, passengerEmail: a.employee.email });
    await prisma.booking.create({
      data: { requestId, assignmentId: a.id, employeeId: a.employeeId, provider: "DEMO", isSimulated: true, reference: b.reference, status: b.status },
    });
  }
}

export async function confirmSimulatedBookings(user: User, requestId: string) {
  if (!["TRAVEL_MANAGER", "ADMIN"].includes(user.role)) throw new HttpError(403, "Not permitted.");
  const req = await prisma.travelRequest.findFirst({ where: { id: requestId, companyId: user.companyId } });
  if (!req) throw new HttpError(404, "Request not found");
  if (req.status !== "PAID") throw new HttpError(409, "Bookings can only be confirmed after payment is captured.");
  const res = await prisma.booking.updateMany({ where: { requestId, status: "SIMULATED_HELD", isSimulated: true }, data: { status: "SIMULATED_CONFIRMED" } });
  await prisma.travelRequest.update({ where: { id: requestId }, data: { status: "BOOKED" } });
  await audit(user.companyId, user, "SIMULATED_BOOKINGS_CONFIRMED", "TravelRequest", requestId, { count: res.count });
  return res.count;
}

export { OPEN_STATUSES };
