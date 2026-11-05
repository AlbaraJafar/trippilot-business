import "server-only";
import { Prisma, type Payment, type User } from "@prisma/client";
import { prisma } from "../db";
import { audit, notify } from "../api";
import { HttpError } from "../auth";
import { FX_DESCRIPTION, formatMoney, sarToUsdCents, toDecimalString } from "../money";
import {
  approveLink,
  captureOrder,
  createOrder,
  getOrder,
  isOutcomeUnknown,
  PayPalApiError,
  PayPalNetworkError,
  PayPalNotConfiguredError,
  PayPalUnreadableResponseError,
  paypalConfig,
  refundCapture,
  type PayPalOrder,
} from "../payments/paypal";
import { getProviderById } from "../providers";

/**
 * AI Payment & Approval Agent — server-side payment orchestration.
 * Amounts are ALWAYS recomputed from persisted itinerary records; the client never
 * supplies an amount, and the AI layer has no access to this module.
 *
 * Financial-safety invariants (P0):
 *  - At most one active payment per travel request (Payment.activeLock is UNIQUE = requestId).
 *  - A payment whose outcome is uncertain or involves money (PAYMENT_BLOCKING) blocks new checkout.
 *  - A request never returns to APPROVED while any of its payments may have been captured.
 *  - Only a verified, COMPLETED PayPal capture makes a request PAID or creates (simulated) holds.
 *  - Uncertainty is resolved by asking PayPal (reconcilePayment), never by elapsed time alone.
 */

/** No money has moved; the payer may still approve on PayPal. */
export const PAYMENT_OPEN = ["CREATED", "PAYER_ACTION_REQUIRED"] as const;
/** Money has moved or may have moved: any of these blocks a new checkout for the same request. */
export const PAYMENT_BLOCKING = ["CAPTURING", "CAPTURE_UNKNOWN", "NEEDS_REVIEW", "CAPTURE_PENDING", "CAPTURED"] as const;
/** Terminal states that free the request's payment slot. */
const RELEASED_STATUSES = ["FAILED", "CANCELLED"] as const;

/** A CAPTURING payment younger than this is treated as still in flight by reconciliation. */
export const CAPTURE_IN_PROGRESS_GRACE_MS = 60_000;
/** A CREATED payment without a PayPal order older than this can be released (no approval link was ever issued). */
export const ORDER_CREATE_GRACE_MS = 120_000;

/** PayPal capture refusals the payer can fix on PayPal — no funds were captured. */
const PAYER_RETRYABLE = ["ORDER_NOT_APPROVED", "INSTRUMENT_DECLINED", "PAYER_ACTION_REQUIRED", "PAYER_CANNOT_PAY"];

const BLOCK_MESSAGES: Record<string, string> = {
  CAPTURING: "A PayPal capture is in progress for this request. Reconcile that payment with PayPal before starting another.",
  CAPTURE_UNKNOWN: "The result of an earlier PayPal capture is unknown. Reconcile that payment with PayPal before starting a new one.",
  NEEDS_REVIEW: "An earlier PayPal capture failed verification and needs manual review. A new payment cannot be started.",
  CAPTURE_PENDING: "PayPal is still processing an earlier capture for this request.",
  CAPTURED: "This request has already been paid.",
};

const isBlocking = (s: string) => (PAYMENT_BLOCKING as readonly string[]).includes(s);
const isOpen = (s: string) => (PAYMENT_OPEN as readonly string[]).includes(s);

type PaymentWithRequest = Payment & { request: { id: string; companyId: string; code: string } };
export interface CaptureResult {
  status: string;
  alreadyCaptured: boolean;
  needsReconciliation?: boolean;
  message?: string;
}
export interface ReconcileResult {
  paymentStatus: string;
  paypalOrderStatus: string | null;
  action: string;
  message: string;
}

async function event(paymentId: string, type: string, message: string, payload?: unknown) {
  await prisma.paymentEvent.create({
    data: { paymentId, type, message, payload: payload ? JSON.stringify(payload).slice(0, 8000) : null },
  });
}

function appUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
}

/** Structured, secret-free description of a PayPal client error (stored as evidence). */
function describeError(e: unknown) {
  if (e instanceof PayPalApiError) return { kind: "API_ERROR", status: e.status, issue: e.issue, debugId: e.debugId, message: e.message };
  if (e instanceof PayPalUnreadableResponseError) return { kind: "UNREADABLE_RESPONSE", status: e.status, debugId: e.debugId, bodySnippet: e.bodySnippet };
  if (e instanceof PayPalNetworkError) return { kind: e.timedOut ? "TIMEOUT" : "NETWORK", message: e.message };
  if (e instanceof PayPalNotConfiguredError) return { kind: "NOT_CONFIGURED", message: e.message };
  return { kind: "UNEXPECTED", message: e instanceof Error ? e.message : String(e) };
}
function errorText(e: unknown) {
  const d = describeError(e) as { kind: string; status?: number; issue?: string; debugId?: string; message?: string };
  return `${d.kind}${d.status ? ` HTTP ${d.status}` : ""}${d.issue ? ` ${d.issue}` : ""}${d.message ? `: ${d.message}` : ""}${d.debugId ? ` (debug id ${d.debugId})` : ""}`;
}

/** Compact, secret-free snapshot of a PayPal order for investigation. */
function orderEvidence(order: PayPalOrder, problem: string, extra?: Record<string, unknown>) {
  return JSON.stringify({
    at: new Date().toISOString(),
    problem,
    orderId: order.id,
    orderStatus: order.status,
    payerId: order.payer?.payer_id ?? null,
    purchaseUnits: (order.purchase_units ?? []).map((pu) => ({
      reference_id: pu.reference_id ?? null,
      custom_id: pu.custom_id ?? null,
      amount: pu.amount ?? null,
      captures: (pu.payments?.captures ?? []).map((c) => ({ id: c.id, status: c.status, amount: c.amount, create_time: c.create_time })),
    })),
    ...extra,
  });
}

/** Move the request back to APPROVED only if none of its payments is open or may involve money. */
async function releaseRequestIfSafe(requestId: string) {
  const busy = await prisma.payment.count({
    where: { requestId, source: { not: "SEEDED_HISTORY" }, status: { in: [...PAYMENT_OPEN, ...PAYMENT_BLOCKING] } },
  });
  if (busy === 0) await prisma.travelRequest.updateMany({ where: { id: requestId, status: "PAYMENT_PENDING" }, data: { status: "APPROVED" } });
}

/** Terminal outcome with no funds captured: frees the request's payment slot. */
async function markReleased(payment: Payment, status: (typeof RELEASED_STATUSES)[number], message: string, eventType: string, payload?: unknown) {
  await prisma.payment.update({ where: { id: payment.id }, data: { status, activeLock: null, errorMessage: message } });
  await event(payment.id, eventType, message, payload);
  await releaseRequestIfSafe(payment.requestId);
}

async function markCaptureUnknown(payment: Payment, e: unknown, attempt: number, phase: string): Promise<CaptureResult> {
  const message = `PayPal capture outcome unknown (${errorText(e)}). Funds may have been captured — reconcile with PayPal before any further payment.`;
  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status: "CAPTURE_UNKNOWN",
      errorMessage: message,
      reviewEvidence: JSON.stringify({ at: new Date().toISOString(), phase, orderId: payment.paypalOrderId, captureAttempt: attempt, error: describeError(e) }),
    },
  });
  await event(payment.id, "CAPTURE_OUTCOME_UNKNOWN", message, { phase, attempt, error: describeError(e) });
  // The travel request deliberately stays PAYMENT_PENDING.
  return { status: "CAPTURE_UNKNOWN", alreadyCaptured: false, needsReconciliation: true, message };
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
  /** Set when an earlier payment's state forbids a new checkout. */
  blockedBy: { paymentId: string; status: string; message: string } | null;
}

async function findBlockingPayment(requestId: string) {
  return prisma.payment.findFirst({
    where: { requestId, source: { not: "SEEDED_HISTORY" }, status: { in: [...PAYMENT_BLOCKING] } },
    orderBy: { createdAt: "desc" },
  });
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
  const blocking = await findBlockingPayment(requestId);
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
    blockedBy: blocking ? { paymentId: blocking.id, status: blocking.status, message: BLOCK_MESSAGES[blocking.status] } : null,
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

  // Any payment that has or may have moved money blocks a new checkout until it is resolved with PayPal.
  if (preview.blockedBy) throw new HttpError(409, preview.blockedBy.message);

  // Business rules are validated first; only then do we require a live PayPal configuration.
  if (!cfg.configured) throw new HttpError(503, new PayPalNotConfiguredError().message);
  if (!cfg.currencySupported) throw new HttpError(500, `PAYPAL_CHARGE_CURRENCY=${cfg.chargeCurrency} is not supported by PayPal REST APIs.`);

  // The request's payment slot: reuse an open order, or refuse while one is being created.
  const active = await prisma.payment.findUnique({ where: { activeLock: requestId } });
  if (active) {
    if (isBlocking(active.status)) throw new HttpError(409, BLOCK_MESSAGES[active.status]);
    if (isOpen(active.status) && active.approveUrl && active.itineraryId === preview.itineraryId && active.amountMinor === preview.amountMinor) {
      await event(active.id, "CHECKOUT_REUSED", "Existing open PayPal order reused (duplicate attempt prevented).");
      return { paymentId: active.id, approveUrl: active.approveUrl, reused: true };
    }
    if (isOpen(active.status) && !active.paypalOrderId)
      throw new HttpError(409, "A PayPal order is already being created for this request. Wait a moment and refresh.");
    throw new HttpError(409, "Another open PayPal order exists for this request. Cancel it on PayPal or reconcile it first.");
  }

  // Atomic slot acquisition: the UNIQUE activeLock index guarantees only one of several concurrent
  // checkouts can insert; the request moves to PAYMENT_PENDING in the same transaction.
  let payment: Payment;
  try {
    [payment] = await prisma.$transaction([
      prisma.payment.create({
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
          activeLock: requestId,
          idempotencyKey: `tp-order-${crypto.randomUUID()}`,
          consentById: user.id,
          consentAt: new Date(),
        },
      }),
      prisma.travelRequest.update({ where: { id: requestId }, data: { status: "PAYMENT_PENDING" } }),
    ]);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      throw new HttpError(409, "Another checkout for this request is already in progress. Refresh and try again.");
    throw e;
  }
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
    await audit(user.companyId, user, "PAYPAL_ORDER_CREATED", "Payment", payment.id, { orderId: order.id, amount: preview.amountMinor, charge: preview.chargeAmountMinor });
    return { paymentId: payment.id, approveUrl: url, reused: false };
  } catch (e) {
    // Safe to release even when the outcome is unknown: without an approval link the payer cannot
    // approve any order PayPal may have created, so no funds can be captured against it.
    const msg = `PayPal order creation failed: ${errorText(e)}`;
    await markReleased(payment, "FAILED", isOutcomeUnknown(e) ? `${msg}. Any order PayPal may have created was never shown to a payer and will expire unapproved.` : msg, "ORDER_CREATE_FAILED", describeError(e));
    throw new HttpError(502, msg);
  }
}

export function verifyCapture(payment: Payment, order: PayPalOrder): { ok: boolean; captureId?: string; status?: string; problem?: string } {
  if (payment.paypalOrderId && order.id !== payment.paypalOrderId) return { ok: false, problem: `Order id mismatch (${order.id} vs ${payment.paypalOrderId}).` };
  const units = order.purchase_units ?? [];
  if (units.length !== 1) return { ok: false, problem: `Expected 1 purchase unit, PayPal returned ${units.length}.` };
  const pu = units[0];
  const captures = pu.payments?.captures ?? [];
  const cap = captures[0];
  if (!cap) return { ok: false, problem: "No capture returned by PayPal." };
  if (captures.length > 1) return { ok: false, captureId: cap.id, problem: `PayPal returned ${captures.length} captures for one order.` };
  if (pu.reference_id !== payment.id) return { ok: false, captureId: cap.id, problem: `Reference id mismatch (${pu.reference_id ?? "missing"}).` };
  if (cap.amount.currency_code !== payment.chargeCurrency) return { ok: false, captureId: cap.id, problem: `Currency mismatch (${cap.amount.currency_code}).` };
  if (cap.amount.value !== toDecimalString(payment.chargeAmountMinor))
    return { ok: false, captureId: cap.id, problem: `Amount mismatch (${cap.amount.value} vs ${toDecimalString(payment.chargeAmountMinor)}).` };
  return { ok: true, captureId: cap.id, status: cap.status };
}

/**
 * Apply PayPal's authoritative order state to our records after a capture (or reconciliation).
 * Only a verified COMPLETED capture makes the request PAID and creates simulated holds.
 */
async function applyCapturedOrder(actor: User | null, payment: PaymentWithRequest, order: PayPalOrder): Promise<CaptureResult> {
  const v = verifyCapture(payment, order);
  const problem = !v.ok ? v.problem! : v.status === "COMPLETED" && order.status !== "COMPLETED" ? `Capture is COMPLETED but order status is ${order.status}.` : null;
  if (problem) {
    const message = `Verification failed: ${problem} Funds may have been captured — manual review required before any further payment.`;
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: "NEEDS_REVIEW", paypalCaptureId: v.captureId ?? payment.paypalCaptureId, errorMessage: message, reviewEvidence: orderEvidence(order, problem) },
    });
    await event(payment.id, "CAPTURE_VERIFICATION_FAILED", problem, { orderId: order.id, orderStatus: order.status, captureId: v.captureId });
    await audit(payment.request.companyId, actor, "PAYMENT_NEEDS_REVIEW", "Payment", payment.id, { problem, orderId: order.id, captureId: v.captureId });
    return { status: "NEEDS_REVIEW", alreadyCaptured: false, needsReconciliation: false, message };
  }

  const payer = { payerId: order.payer?.payer_id ?? null, payerEmail: order.payer?.email_address ?? null };
  if (v.status === "COMPLETED") {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: "CAPTURED", paypalCaptureId: v.captureId, ...payer, capturedAt: new Date(), errorMessage: null },
    });
    await event(payment.id, "CAPTURE_COMPLETED", `Capture ${v.captureId} COMPLETED; order id, reference, currency and amount verified.`, { orderStatus: order.status, captureStatus: v.status });
    await prisma.travelRequest.updateMany({ where: { id: payment.requestId, status: { in: ["PAYMENT_PENDING", "APPROVED"] } }, data: { status: "PAID" } });
    await createSimulatedHolds(payment.requestId);
    await audit(payment.request.companyId, actor, "PAYMENT_CAPTURED", "Payment", payment.id, { captureId: v.captureId, amount: payment.amountMinor });
    await notify(payment.request.companyId, {
      kind: "PAYMENT",
      title: `PayPal payment captured · ${payment.request.code}`,
      body: `${formatMoney(payment.chargeAmountMinor, payment.chargeCurrency, { decimals: true })} (${formatMoney(payment.amountMinor)}) — Sandbox`,
      link: `/payments/${payment.id}`,
    });
    return { status: "CAPTURED", alreadyCaptured: false };
  }
  if (v.status === "PENDING") {
    const message = `PayPal accepted capture ${v.captureId} but it is PENDING. The request is not marked paid and no holds are created until PayPal completes it.`;
    await prisma.payment.update({ where: { id: payment.id }, data: { status: "CAPTURE_PENDING", paypalCaptureId: v.captureId, ...payer, errorMessage: null } });
    await event(payment.id, "CAPTURE_PENDING", message, { orderStatus: order.status, captureStatus: v.status });
    return { status: "CAPTURE_PENDING", alreadyCaptured: false, message };
  }
  if (v.status === "DECLINED" || v.status === "FAILED") {
    const message = `PayPal reports capture ${v.captureId} as ${v.status}; no funds were captured.`;
    await prisma.payment.update({ where: { id: payment.id }, data: { paypalCaptureId: v.captureId } });
    await markReleased(payment, "FAILED", message, "CAPTURE_DECLINED", { captureStatus: v.status });
    return { status: "FAILED", alreadyCaptured: false, message };
  }
  const unexpected = `Unexpected capture status ${v.status}.`;
  await prisma.payment.update({
    where: { id: payment.id },
    data: { status: "NEEDS_REVIEW", paypalCaptureId: v.captureId, errorMessage: `${unexpected} Manual review required.`, reviewEvidence: orderEvidence(order, unexpected) },
  });
  await event(payment.id, "CAPTURE_VERIFICATION_FAILED", unexpected);
  return { status: "NEEDS_REVIEW", alreadyCaptured: false, message: unexpected };
}

/**
 * Take the capture lock (compare-and-set on status + attempt counter), call PayPal once, and classify
 * the result. Each attempt uses its own PayPal-Request-Id; PayPal itself refuses to capture an order twice.
 */
async function runCapture(actor: User | null, payment: PaymentWithRequest, from: string[]): Promise<CaptureResult> {
  const attempt = payment.captureAttempts + 1;
  const lock = await prisma.payment.updateMany({
    where: { id: payment.id, status: { in: from }, captureAttempts: payment.captureAttempts },
    data: { status: "CAPTURING", captureAttempts: attempt, captureStartedAt: new Date() },
  });
  if (lock.count !== 1) {
    const cur = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    return { status: cur.status, alreadyCaptured: true, needsReconciliation: ["CAPTURING", "CAPTURE_UNKNOWN"].includes(cur.status) };
  }
  await event(payment.id, "CAPTURE_STARTED", `Capture attempt ${attempt} sent to PayPal.`);
  const orderId = payment.paypalOrderId!;

  let order: PayPalOrder;
  try {
    order = await captureOrder(orderId, `tp-capture-${payment.id}-${attempt}`);
  } catch (e) {
    if (e instanceof PayPalApiError && e.issue === "ORDER_ALREADY_CAPTURED") {
      try {
        order = await getOrder(orderId);
      } catch (e2) {
        return markCaptureUnknown(payment, e2, attempt, "GET_ORDER_AFTER_ALREADY_CAPTURED");
      }
    } else if (isOutcomeUnknown(e)) {
      return markCaptureUnknown(payment, e, attempt, "CAPTURE");
    } else if (e instanceof PayPalNotConfiguredError || (e instanceof PayPalApiError && !e.requestSent)) {
      // The capture request never left the server: restore the previous state.
      await prisma.payment.update({ where: { id: payment.id }, data: { status: payment.status, errorMessage: errorText(e) } });
      await event(payment.id, "CAPTURE_NOT_SENT", `Capture was not sent to PayPal: ${errorText(e)}`);
      throw new HttpError(e instanceof PayPalNotConfiguredError ? 503 : 502, `Capture not sent: ${errorText(e)}`);
    } else if (e instanceof PayPalApiError && PAYER_RETRYABLE.includes(e.issue ?? "")) {
      const msg = `${e.issue} ${e.message}`.trim();
      await prisma.payment.update({ where: { id: payment.id }, data: { status: "PAYER_ACTION_REQUIRED", errorMessage: msg } });
      await event(payment.id, "CAPTURE_REFUSED_PAYER_ACTION", `${msg} — no funds captured; the payer can retry on PayPal.`);
      throw new HttpError(402, `Capture failed: ${msg}`);
    } else {
      // A definitive rejection (4xx). Confirm with PayPal that the order is not captured before releasing.
      let check: PayPalOrder;
      try {
        check = await getOrder(orderId);
      } catch {
        return markCaptureUnknown(payment, e, attempt, "CAPTURE_REJECTED_UNCONFIRMED");
      }
      if (check.status !== "COMPLETED") {
        const msg = `Capture rejected by PayPal (${errorText(e)}); PayPal confirms order status ${check.status}.`;
        await markReleased(payment, "FAILED", msg, "CAPTURE_FAILED", describeError(e));
        throw new HttpError(402, `Capture failed: ${msg}`);
      }
      order = check;
    }
  }
  return applyCapturedOrder(actor, payment, order);
}

async function loadPayment(user: User, paymentId: string): Promise<PaymentWithRequest> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId }, include: { request: true } });
  if (!payment || payment.request.companyId !== user.companyId) throw new HttpError(404, "Payment not found.");
  return payment;
}

/** Step 12: capture after the payer approves on PayPal. Safe to call more than once. */
export async function capturePayment(user: User, paymentId: string, orderIdFromReturn: string): Promise<CaptureResult> {
  const payment = await loadPayment(user, paymentId);
  if (!payment.paypalOrderId || payment.paypalOrderId !== orderIdFromReturn) throw new HttpError(400, "Order id does not match this payment.");
  if (isBlocking(payment.status)) {
    // Never start a second capture; uncertain states are resolved through reconciliation only.
    return {
      status: payment.status,
      alreadyCaptured: true,
      needsReconciliation: ["CAPTURING", "CAPTURE_UNKNOWN"].includes(payment.status),
      message: BLOCK_MESSAGES[payment.status],
    };
  }
  if (!isOpen(payment.status)) throw new HttpError(409, `Payment is ${payment.status}; cannot capture.`);
  return runCapture(user, payment, [...PAYMENT_OPEN]);
}

export async function cancelCheckout(user: User, paymentId: string) {
  const payment = await loadPayment(user, paymentId);
  const res = await prisma.payment.updateMany({
    where: { id: paymentId, status: { in: [...PAYMENT_OPEN] } },
    data: { status: "CANCELLED", activeLock: null },
  });
  if (res.count) {
    await event(paymentId, "CHECKOUT_CANCELLED", "Payer cancelled on PayPal (order left uncaptured).");
    await releaseRequestIfSafe(payment.requestId);
  }
}

/** Ask PayPal for the authoritative state of a payment's order and resolve any uncertainty. */
export async function reconcilePayment(user: User, paymentId: string): Promise<ReconcileResult> {
  return reconcileLoaded(user, await loadPayment(user, paymentId));
}

/** Webhook entry point: no user session; actions are attributed to the TripPilot agent. */
export async function reconcilePaymentById(paymentId: string): Promise<ReconcileResult> {
  const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { request: true } });
  return reconcileLoaded(null, payment);
}

async function reconcileLoaded(actor: User | null, payment: PaymentWithRequest): Promise<ReconcileResult> {
  const result = (paymentStatus: string, paypalOrderStatus: string | null, action: string, message: string): ReconcileResult => ({ paymentStatus, paypalOrderStatus, action, message });
  if (payment.source === "SEEDED_HISTORY") throw new HttpError(409, "Historical records are not PayPal transactions.");

  if (!payment.paypalOrderId) {
    if (payment.status === "CREATED" && Date.now() - payment.createdAt.getTime() > ORDER_CREATE_GRACE_MS) {
      const msg = "PayPal order creation never completed. No approval link was issued, so no funds can have moved.";
      await markReleased(payment, "FAILED", msg, "ORDER_CREATE_ABANDONED");
      return result("FAILED", null, "RELEASED", msg);
    }
    if (payment.status === "CREATED") throw new HttpError(409, "PayPal order creation is still in progress. Try again in a minute.");
    return result(payment.status, null, "NONE", "This payment has no PayPal order.");
  }

  if (payment.status === "CAPTURING" && payment.captureStartedAt && Date.now() - payment.captureStartedAt.getTime() < CAPTURE_IN_PROGRESS_GRACE_MS)
    throw new HttpError(409, "A capture is in progress. Try reconciling again in a minute.");

  let order: PayPalOrder;
  try {
    order = await getOrder(payment.paypalOrderId);
  } catch (e) {
    if (e instanceof PayPalApiError && e.status === 404 && ["CREATED", "PAYER_ACTION_REQUIRED", "CAPTURING", "CAPTURE_UNKNOWN"].includes(payment.status)) {
      // A captured order stays retrievable; a missing order was never captured (e.g. expired unapproved).
      const msg = `PayPal has no order ${payment.paypalOrderId} (${errorText(e)}); it was never captured.`;
      await markReleased(payment, "FAILED", msg, "RECONCILE_ORDER_NOT_FOUND");
      return result("FAILED", null, "RELEASED", msg);
    }
    await event(payment.id, "RECONCILE_FAILED", `Could not read the order from PayPal: ${errorText(e)}. Status unchanged (${payment.status}).`);
    throw new HttpError(502, `Could not reach PayPal to reconcile (${errorText(e)}). Payment status unchanged: ${payment.status}.`);
  }

  await prisma.payment.update({ where: { id: payment.id }, data: { lastReconciledAt: new Date() } });
  await event(payment.id, "RECONCILED", `PayPal reports order ${order.id} as ${order.status} (TripPilot status was ${payment.status}).`, {
    orderStatus: order.status,
    captures: order.purchase_units?.[0]?.payments?.captures?.map((c) => ({ id: c.id, status: c.status })) ?? [],
  });

  // Our record says no funds moved, but PayPal shows a capture: escalate instead of trusting our record.
  if ((RELEASED_STATUSES as readonly string[]).includes(payment.status) && order.status === "COMPLETED") {
    const problem = `TripPilot recorded ${payment.status}, but PayPal shows the order COMPLETED.`;
    try {
      await prisma.payment.update({ where: { id: payment.id }, data: { status: "NEEDS_REVIEW", activeLock: payment.requestId, reviewEvidence: orderEvidence(order, problem), errorMessage: `${problem} Manual review required.` } });
    } catch {
      await prisma.payment.update({ where: { id: payment.id }, data: { status: "NEEDS_REVIEW", reviewEvidence: orderEvidence(order, problem), errorMessage: `${problem} Manual review required.` } });
    }
    await prisma.travelRequest.updateMany({ where: { id: payment.requestId, status: "APPROVED" }, data: { status: "PAYMENT_PENDING" } });
    await event(payment.id, "RECONCILE_MISMATCH", problem);
    return result("NEEDS_REVIEW", order.status, "ESCALATED_TO_REVIEW", problem);
  }
  if (["CAPTURED", "FAILED", "CANCELLED", "REFUNDED"].includes(payment.status)) return result(payment.status, order.status, "NONE", "Payment already final; PayPal state recorded.");

  switch (order.status) {
    case "COMPLETED": {
      const r = await applyCapturedOrder(actor, payment, order);
      return result(r.status, order.status, "APPLIED_PAYPAL_CAPTURE", r.message ?? `PayPal capture recorded as ${r.status}.`);
    }
    case "APPROVED": {
      if (payment.status === "NEEDS_REVIEW" || payment.status === "CAPTURE_PENDING")
        return result(payment.status, order.status, "NONE", "Order approved but not captured; left for manual review.");
      const r = await runCapture(actor, payment, [payment.status]);
      return result(r.status, order.status, "CAPTURED_APPROVED_ORDER", r.message ?? `Approved order captured: ${r.status}.`);
    }
    case "CREATED":
    case "SAVED":
    case "PAYER_ACTION_REQUIRED": {
      if (payment.status === "CAPTURING" || payment.status === "CAPTURE_UNKNOWN") {
        const msg = "PayPal confirms the buyer has not approved this order, so nothing was captured. The payer can resume on PayPal.";
        await prisma.payment.updateMany({ where: { id: payment.id, status: payment.status }, data: { status: "PAYER_ACTION_REQUIRED", errorMessage: null } });
        await event(payment.id, "RECONCILE_RESTORED", msg);
        return result("PAYER_ACTION_REQUIRED", order.status, "RESTORED_AWAITING_PAYER", msg);
      }
      return result(payment.status, order.status, "NONE", "Waiting for the payer to approve on PayPal.");
    }
    case "VOIDED": {
      if (payment.status === "NEEDS_REVIEW") return result(payment.status, order.status, "NONE", "Order voided; left for manual review.");
      const msg = "PayPal voided this order; no funds were captured.";
      await markReleased(payment, "FAILED", msg, "RECONCILE_VOIDED");
      return result("FAILED", order.status, "RELEASED", msg);
    }
    default:
      return result(payment.status, order.status, "NONE", `Unrecognised PayPal order status ${order.status}; nothing changed.`);
  }
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

