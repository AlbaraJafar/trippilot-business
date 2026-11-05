import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import type { Payment, User } from "@prisma/client";

/**
 * P0 financial-safety tests for the payment service.
 *
 * These run against a real (isolated) SQLite database built from the migrations, with PayPal's
 * HTTP API MOCKED via a stubbed global fetch. They are NOT PayPal Sandbox transactions: they prove
 * how TripPilot reacts to each PayPal outcome, not that PayPal behaves this way.
 */

process.env.PAYPAL_CLIENT_ID = "test-client";
process.env.PAYPAL_CLIENT_SECRET = "test-secret";
process.env.PAYPAL_BASE_URL = "https://api-m.sandbox.paypal.com";
process.env.PAYPAL_CHARGE_CURRENCY = "USD";

const { prisma } = await import("@/lib/db");
const svc = await import("@/lib/services/payments");

// ---------------------------------------------------------------- mocked PayPal HTTP API
type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "paypal-debug-id": "dbg-test" } });
const timeout = () => {
  throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
};
let paypal: { createOrder?: Handler; capture?: Handler; getOrder?: Handler };
let calls: { method: string; url: string; requestId?: string }[];
const callsTo = (kind: "create" | "capture" | "get") =>
  calls.filter((c) =>
    kind === "create" ? c.method === "POST" && /\/v2\/checkout\/orders$/.test(c.url)
    : kind === "capture" ? c.method === "POST" && c.url.endsWith("/capture")
    : c.method === "GET" && /\/v2\/checkout\/orders\/[^/]+$/.test(c.url),
  );

beforeEach(() => {
  calls = [];
  paypal = {
    createOrder: (_u, init) => {
      const body = JSON.parse(init.body as string);
      const id = `ORDER-${body.purchase_units[0].reference_id}`;
      return json(201, { id, status: "PAYER_ACTION_REQUIRED", links: [{ rel: "payer-action", href: `https://www.sandbox.paypal.com/checkoutnow?token=${id}`, method: "GET" }] });
    },
  };
  vi.stubGlobal("fetch", async (input: string, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    const headers = (init.headers ?? {}) as Record<string, string>;
    calls.push({ method, url, requestId: headers["PayPal-Request-Id"] });
    if (url.endsWith("/v1/oauth2/token")) return json(200, { access_token: "A21-test-token", expires_in: 3600 });
    const route: Handler | undefined =
      method === "POST" && /\/v2\/checkout\/orders$/.test(url) ? paypal.createOrder
      : method === "POST" && url.endsWith("/capture") ? paypal.capture
      : method === "GET" && /\/v2\/checkout\/orders\/[^/]+$/.test(url) ? paypal.getOrder
      : undefined;
    if (!route) throw new Error(`Unexpected PayPal call in test: ${method} ${url}`);
    return route(url, init);
  });
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => prisma.$disconnect());

// ---------------------------------------------------------------- PayPal order bodies
const CHARGE = "320.00"; // SAR 1,200.00 at 3.75 SAR/USD
function capturedOrder(p: Payment, o: { orderStatus?: string; captureStatus?: string; value?: string; ref?: string } = {}) {
  return {
    id: p.paypalOrderId,
    status: o.orderStatus ?? "COMPLETED",
    links: [],
    payer: { payer_id: "BUYER123", email_address: "buyer@example.test" },
    purchase_units: [
      {
        reference_id: o.ref ?? p.id,
        amount: { currency_code: "USD", value: CHARGE },
        payments: { captures: [{ id: `CAP-${p.id}`, status: o.captureStatus ?? "COMPLETED", amount: { currency_code: "USD", value: o.value ?? CHARGE } }] },
      },
    ],
  };
}
const uncapturedOrder = (p: Payment, status: string) => ({
  id: p.paypalOrderId,
  status,
  links: [],
  purchase_units: [{ reference_id: p.id, amount: { currency_code: "USD", value: CHARGE } }],
});

// ---------------------------------------------------------------- fixtures
interface Fx { user: User; requestId: string }
async function fixture(): Promise<Fx> {
  const s = randomBytes(4).toString("hex");
  const company = await prisma.company.create({ data: { name: `Test Co ${s}` } });
  const dept = await prisma.department.create({ data: { companyId: company.id, code: `D${s}`, name: "Consulting", budgetMinor: 10_000_000 } });
  const emp = await prisma.employee.create({
    data: { companyId: company.id, employeeCode: `E${s}`, fullName: "Test Traveler", email: `t${s}@example.test`, departmentId: dept.id, jobTitle: "Consultant", budgetLimitMinor: 150_000 },
  });
  const user = await prisma.user.create({ data: { companyId: company.id, name: "Test Manager", email: `tm${s}@example.test`, role: "TRAVEL_MANAGER", title: "Travel Manager" } });
  const req = await prisma.travelRequest.create({
    data: {
      code: `TR-T${s}`, companyId: company.id, departmentId: dept.id, createdById: user.id, title: "Test trip", purpose: "Test", mode: "INDIVIDUAL",
      origin: "RUH", destination: "JED", outboundDates: '["2027-03-15"]', returnDates: '["2027-03-16"]', maxPerEmployeeMinor: 150_000, totalBudgetMinor: 1_500_000, status: "APPROVED",
    },
  });
  const flight = await prisma.flightOption.create({
    data: {
      requestId: req.id, provider: "DEMO", isDemo: true, providerRef: `DEMO-${s}`, direction: "OUTBOUND", airline: "SV", airlineName: "Saudia", flightNumber: "SV1000",
      origin: "RUH", destination: "JED", date: "2027-03-15", departTime: "07:00", arriveTime: "08:40", durationMin: 100, cabin: "ECONOMY", baggage: "CHECKED", baggageKg: 23, seatsLeft: 9, priceMinor: 120_000,
    },
  });
  const it = await prisma.itinerary.create({
    data: {
      requestId: req.id, strategy: "BALANCED", label: "Balanced", totalMinor: 120_000, baselineMinor: 120_000, score: 800, policyStatus: "COMPLIANT", feasible: true,
      explanation: "test", explainedBy: "DETERMINISTIC", facts: "{}",
      assignments: { create: [{ employeeId: emp.id, outboundFlightId: flight.id, priceMinor: 120_000, score: 800, policyStatus: "COMPLIANT", findings: "[]" }] },
    },
  });
  await prisma.approval.create({
    data: { requestId: req.id, itineraryId: it.id, level: 1, requiredRole: "TRAVEL_MANAGER", reasons: "[]", amountMinor: 120_000, status: "APPROVED", decidedById: user.id, decidedAt: new Date() },
  });
  await prisma.travelRequest.update({ where: { id: req.id }, data: { selectedItineraryId: it.id } });
  return { user, requestId: req.id };
}

const checkout = (fx: Fx) => svc.createCheckout(fx.user, fx.requestId, { accepted: true, amountMinor: 120_000 });

/** A payment whose PayPal order the buyer has approved (PAYER_ACTION_REQUIRED in our records). */
async function approvedPayment(fx: Fx) {
  const r = await checkout(fx);
  return prisma.payment.findUniqueOrThrow({ where: { id: r.paymentId } });
}
const reload = (id: string) => prisma.payment.findUniqueOrThrow({ where: { id } });
const requestStatus = async (fx: Fx) => (await prisma.travelRequest.findUniqueOrThrow({ where: { id: fx.requestId } })).status;
const bookings = (fx: Fx) => prisma.booking.count({ where: { requestId: fx.requestId } });

/** The core invariant: nothing new can be paid for this request, and no PayPal order is created. */
async function expectCheckoutBlocked(fx: Fx) {
  const before = callsTo("create").length;
  await expect(checkout(fx)).rejects.toMatchObject({ status: 409 });
  expect(callsTo("create").length).toBe(before);
  expect(await requestStatus(fx)).not.toBe("APPROVED");
}

beforeAll(async () => {
  // Sanity: we are on the isolated test database.
  expect(process.env.DATABASE_URL).toBe("file:./test.db");
});

// ================================================================= R1 — ambiguous capture outcomes
describe("R1 · ambiguous capture outcome → CAPTURE_UNKNOWN", () => {
  it("1. PayPal times out after a potentially successful capture", async () => {
    const fx = await fixture();
    const p = await approvedPayment(fx);
    paypal.capture = timeout;

    const r = await svc.capturePayment(fx.user, p.id, p.paypalOrderId!);

    expect(r).toMatchObject({ status: "CAPTURE_UNKNOWN", needsReconciliation: true });
    const after = await reload(p.id);
    expect(after.status).toBe("CAPTURE_UNKNOWN");
    expect(after.paypalOrderId).toBe(p.paypalOrderId); // order id preserved
    expect(after.activeLock).toBe(fx.requestId); // slot still held
    expect(JSON.parse(after.reviewEvidence!)).toMatchObject({ phase: "CAPTURE", error: { kind: "TIMEOUT" } });
    expect(await requestStatus(fx)).toBe("PAYMENT_PENDING"); // NOT back to APPROVED
    expect(await bookings(fx)).toBe(0);
    await expectCheckoutBlocked(fx);

    // A refresh of the return page must not send a second capture.
    const again = await svc.capturePayment(fx.user, p.id, p.paypalOrderId!);
    expect(again).toMatchObject({ status: "CAPTURE_UNKNOWN", alreadyCaptured: true });
    expect(callsTo("capture")).toHaveLength(1);
  });

  it("2a. PayPal returns a non-JSON body (HTML gateway error) after capture", async () => {
    const fx = await fixture();
    const p = await approvedPayment(fx);
    paypal.capture = () => new Response("<html><body>502 Bad Gateway</body></html>", { status: 502 });

    const r = await svc.capturePayment(fx.user, p.id, p.paypalOrderId!);

    expect(r.status).toBe("CAPTURE_UNKNOWN");
    const after = await reload(p.id);
    expect(JSON.parse(after.reviewEvidence!).error).toMatchObject({ kind: "UNREADABLE_RESPONSE", status: 502 });
    expect(await requestStatus(fx)).toBe("PAYMENT_PENDING");
    await expectCheckoutBlocked(fx);
  });

  it("2b. PayPal returns 201 with a truncated (unparseable) body", async () => {
    const fx = await fixture();
    const p = await approvedPayment(fx);
    paypal.capture = () => new Response('{"id":"ORDER","status":"COMPL', { status: 201 });

    expect((await svc.capturePayment(fx.user, p.id, p.paypalOrderId!)).status).toBe("CAPTURE_UNKNOWN");
    expect((await reload(p.id)).status).toBe("CAPTURE_UNKNOWN");
    await expectCheckoutBlocked(fx);
  });
});

// ================================================================= R2 — verification failures
describe("R2 · verification failure → NEEDS_REVIEW", () => {
  it("3. capture amount does not match the payment", async () => {
    const fx = await fixture();
    const p = await approvedPayment(fx);
    paypal.capture = () => json(201, capturedOrder(p, { value: "319.99" }));

    const r = await svc.capturePayment(fx.user, p.id, p.paypalOrderId!);

    expect(r.status).toBe("NEEDS_REVIEW");
    const after = await reload(p.id);
    expect(after.status).toBe("NEEDS_REVIEW");
    expect(after.paypalOrderId).toBe(p.paypalOrderId);
    expect(after.paypalCaptureId).toBe(`CAP-${p.id}`); // PayPal identifiers preserved
    expect(after.errorMessage).toMatch(/manual review/i);
    const evidence = JSON.parse(after.reviewEvidence!);
    expect(evidence.problem).toMatch(/Amount mismatch \(319\.99 vs 320\.00\)/);
    expect(evidence.purchaseUnits[0].captures[0]).toMatchObject({ id: `CAP-${p.id}`, status: "COMPLETED", amount: { value: "319.99" } });
    expect(await requestStatus(fx)).toBe("PAYMENT_PENDING"); // neither PAID nor APPROVED
    expect(await bookings(fx)).toBe(0);
    await expectCheckoutBlocked(fx);
  });

  it("3b. capture against another reference id is also held for review", async () => {
    const fx = await fixture();
    const p = await approvedPayment(fx);
    paypal.capture = () => json(201, capturedOrder(p, { ref: "someone-else" }));
    expect((await svc.capturePayment(fx.user, p.id, p.paypalOrderId!)).status).toBe("NEEDS_REVIEW");
    await expectCheckoutBlocked(fx);
  });
});

// ================================================================= R3 — stuck CAPTURING
describe("R3 · interrupted capture left in CAPTURING", () => {
  it("4. blocks checkout, never assumes failure from elapsed time, and resolves via PayPal", async () => {
    const fx = await fixture();
    const p = await approvedPayment(fx);
    // Simulate a process that died after taking the capture lock (and possibly after PayPal captured).
    await prisma.payment.update({ where: { id: p.id }, data: { status: "CAPTURING", captureAttempts: 1, captureStartedAt: new Date() } });

    await expectCheckoutBlocked(fx);
    // Return-page refresh: no second capture is sent.
    expect(await svc.capturePayment(fx.user, p.id, p.paypalOrderId!)).toMatchObject({ status: "CAPTURING", alreadyCaptured: true });
    // Reconciling a capture that may still be in flight is refused without calling PayPal.
    await expect(svc.reconcilePayment(fx.user, p.id)).rejects.toMatchObject({ status: 409 });
    expect(callsTo("get")).toHaveLength(0);

    // Hours later: if PayPal cannot be reached the status stays CAPTURING (no time-based failure).
    await prisma.payment.update({ where: { id: p.id }, data: { captureStartedAt: new Date(Date.now() - 6 * 3600_000) } });
    paypal.getOrder = timeout;
    await expect(svc.reconcilePayment(fx.user, p.id)).rejects.toMatchObject({ status: 502 });
    expect((await reload(p.id)).status).toBe("CAPTURING");
    expect(await requestStatus(fx)).toBe("PAYMENT_PENDING");
    await expectCheckoutBlocked(fx);

    // Once PayPal answers, its real state decides: here the earlier capture had in fact completed.
    paypal.getOrder = () => json(200, capturedOrder(p));
    const r = await svc.reconcilePayment(fx.user, p.id);
    expect(r).toMatchObject({ paymentStatus: "CAPTURED", paypalOrderStatus: "COMPLETED", action: "APPLIED_PAYPAL_CAPTURE" });
    expect(callsTo("capture")).toHaveLength(0); // recorded from PayPal, never re-captured
    expect(await requestStatus(fx)).toBe("PAID");
  });
});

// ================================================================= R4 — concurrent checkout
describe("R4 · concurrent checkout", () => {
  it("5. two simultaneous checkout calls create exactly one PayPal order", async () => {
    const fx = await fixture();
    const create = paypal.createOrder!;
    paypal.createOrder = async (u, init) => {
      await new Promise((r) => setTimeout(r, 50)); // keep the first order "in flight"
      return create(u, init);
    };

    const results = await Promise.allSettled([checkout(fx), checkout(fx)]);

    const ok = results.filter((r) => r.status === "fulfilled");
    const refused = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0].reason).toMatchObject({ status: 409 });
    expect(callsTo("create")).toHaveLength(1);
    expect(await prisma.payment.count({ where: { requestId: fx.requestId } })).toBe(1);

    // A later retry reuses the same open order instead of creating another.
    const again = await checkout(fx);
    expect(again).toMatchObject({ reused: true, paymentId: (ok[0] as PromiseFulfilledResult<{ paymentId: string }>).value.paymentId });
    expect(callsTo("create")).toHaveLength(1);
  });

  it("5b. the database rejects a second active payment for the same request", async () => {
    const fx = await fixture();
    const p = await approvedPayment(fx);
    await expect(
      prisma.payment.create({
        data: { requestId: fx.requestId, source: "PAYPAL_SANDBOX", amountMinor: 1, chargeAmountMinor: 1, chargeCurrency: "USD", fxRate: "x", status: "CREATED", idempotencyKey: `dup-${p.id}`, activeLock: fx.requestId },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});

// ================================================================= reconciliation outcomes
describe("Reconciliation with PayPal", () => {
  it("6. discovers a completed capture → CAPTURED, request PAID, simulated holds created", async () => {
    const fx = await fixture();
    const p = await approvedPayment(fx);
    paypal.capture = timeout;
    await svc.capturePayment(fx.user, p.id, p.paypalOrderId!);
    expect(await bookings(fx)).toBe(0);

    paypal.getOrder = () => json(200, capturedOrder(p));
    const r = await svc.reconcilePayment(fx.user, p.id);

    expect(r).toMatchObject({ paymentStatus: "CAPTURED", action: "APPLIED_PAYPAL_CAPTURE" });
    const after = await reload(p.id);
    expect(after).toMatchObject({ status: "CAPTURED", paypalCaptureId: `CAP-${p.id}`, payerId: "BUYER123" });
    expect(after.capturedAt).not.toBeNull();
    expect(await requestStatus(fx)).toBe("PAID");
    const b = await prisma.booking.findMany({ where: { requestId: fx.requestId } });
    expect(b.map((x) => x.status)).toEqual(["SIMULATED_HELD"]); // booking status stays separate
    expect(callsTo("capture")).toHaveLength(1); // only the original (timed-out) attempt
    await expect(checkout(fx)).rejects.toMatchObject({ status: 409 });
  });

  it("6b. a completed order whose capture is PENDING is not treated as paid", async () => {
    const fx = await fixture();
    const p = await approvedPayment(fx);
    paypal.capture = timeout;
    await svc.capturePayment(fx.user, p.id, p.paypalOrderId!);

    paypal.getOrder = () => json(200, capturedOrder(p, { captureStatus: "PENDING" }));
    expect((await svc.reconcilePayment(fx.user, p.id)).paymentStatus).toBe("CAPTURE_PENDING");
    expect(await requestStatus(fx)).toBe("PAYMENT_PENDING");
    expect(await bookings(fx)).toBe(0);
    await expectCheckoutBlocked(fx);

    // PayPal later completes it.
    paypal.getOrder = () => json(200, capturedOrder(p));
    expect((await svc.reconcilePayment(fx.user, p.id)).paymentStatus).toBe("CAPTURED");
    expect(await requestStatus(fx)).toBe("PAID");
  });

  it("7. discovers an approved but uncaptured order → captures it with a new idempotency key", async () => {
    const fx = await fixture();
    const p = await approvedPayment(fx);
    paypal.capture = timeout;
    await svc.capturePayment(fx.user, p.id, p.paypalOrderId!);

    paypal.getOrder = () => json(200, uncapturedOrder(p, "APPROVED"));
    paypal.capture = () => json(201, capturedOrder(p));
    const r = await svc.reconcilePayment(fx.user, p.id);

    expect(r).toMatchObject({ paymentStatus: "CAPTURED", paypalOrderStatus: "APPROVED", action: "CAPTURED_APPROVED_ORDER" });
    const keys = callsTo("capture").map((c) => c.requestId);
    expect(keys).toEqual([`tp-capture-${p.id}-1`, `tp-capture-${p.id}-2`]);
    expect((await reload(p.id)).captureAttempts).toBe(2);
    expect(await requestStatus(fx)).toBe("PAID");
  });

  it("8a. discovers a voided order → FAILED, slot released, request APPROVED, new checkout allowed", async () => {
    const fx = await fixture();
    const p = await approvedPayment(fx);
    paypal.capture = timeout;
    await svc.capturePayment(fx.user, p.id, p.paypalOrderId!);

    paypal.getOrder = () => json(200, uncapturedOrder(p, "VOIDED"));
    const r = await svc.reconcilePayment(fx.user, p.id);

    expect(r).toMatchObject({ paymentStatus: "FAILED", action: "RELEASED" });
    expect(await reload(p.id)).toMatchObject({ status: "FAILED", activeLock: null });
    expect(await requestStatus(fx)).toBe("APPROVED");
    expect(await bookings(fx)).toBe(0);

    const next = await checkout(fx);
    expect(next.reused).toBe(false);
    expect(next.paymentId).not.toBe(p.id);
    expect(callsTo("create")).toHaveLength(2);
  });

  it("8b. discovers a declined capture → FAILED with no funds captured", async () => {
    const fx = await fixture();
    const p = await approvedPayment(fx);
    paypal.capture = timeout;
    await svc.capturePayment(fx.user, p.id, p.paypalOrderId!);

    paypal.getOrder = () => json(200, capturedOrder(p, { captureStatus: "DECLINED" }));
    expect((await svc.reconcilePayment(fx.user, p.id)).paymentStatus).toBe("FAILED");
    expect(await requestStatus(fx)).toBe("APPROVED");
    expect(await bookings(fx)).toBe(0);
  });

  it("8c. discovers the buyer never approved → back to awaiting payer, slot kept", async () => {
    const fx = await fixture();
    const p = await approvedPayment(fx);
    paypal.capture = timeout;
    await svc.capturePayment(fx.user, p.id, p.paypalOrderId!);

    paypal.getOrder = () => json(200, uncapturedOrder(p, "PAYER_ACTION_REQUIRED"));
    expect(await svc.reconcilePayment(fx.user, p.id)).toMatchObject({ paymentStatus: "PAYER_ACTION_REQUIRED", action: "RESTORED_AWAITING_PAYER" });
    expect(await reload(p.id)).toMatchObject({ status: "PAYER_ACTION_REQUIRED", activeLock: fx.requestId });
    // The open order is reused, never duplicated.
    expect(await checkout(fx)).toMatchObject({ reused: true, paymentId: p.id });
    expect(callsTo("create")).toHaveLength(1);
  });

  it("8d. a payment recorded as FAILED that PayPal shows COMPLETED is escalated to review", async () => {
    const fx = await fixture();
    const p = await approvedPayment(fx);
    await prisma.payment.update({ where: { id: p.id }, data: { status: "FAILED", activeLock: null } });
    await prisma.travelRequest.update({ where: { id: fx.requestId }, data: { status: "APPROVED" } });

    paypal.getOrder = () => json(200, capturedOrder(p));
    expect((await svc.reconcilePayment(fx.user, p.id)).paymentStatus).toBe("NEEDS_REVIEW");
    expect(await requestStatus(fx)).toBe("PAYMENT_PENDING");
    await expectCheckoutBlocked(fx);
  });
});

// ================================================================= happy path still works
describe("Normal capture", () => {
  it("verified COMPLETED capture → CAPTURED and PAID; repeat is idempotent", async () => {
    const fx = await fixture();
    const p = await approvedPayment(fx);
    paypal.capture = () => json(201, capturedOrder(p));
    expect(await svc.capturePayment(fx.user, p.id, p.paypalOrderId!)).toMatchObject({ status: "CAPTURED", alreadyCaptured: false });
    expect(await requestStatus(fx)).toBe("PAID");
    expect(await svc.capturePayment(fx.user, p.id, p.paypalOrderId!)).toMatchObject({ status: "CAPTURED", alreadyCaptured: true });
    expect(callsTo("capture")).toHaveLength(1);
  });

  it("a payer-fixable refusal (INSTRUMENT_DECLINED) returns to awaiting payer without releasing the slot", async () => {
    const fx = await fixture();
    const p = await approvedPayment(fx);
    paypal.capture = () => json(422, { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "INSTRUMENT_DECLINED", description: "The instrument presented was declined." }] });
    await expect(svc.capturePayment(fx.user, p.id, p.paypalOrderId!)).rejects.toMatchObject({ status: 402 });
    expect(await reload(p.id)).toMatchObject({ status: "PAYER_ACTION_REQUIRED", activeLock: fx.requestId });
    expect(await requestStatus(fx)).toBe("PAYMENT_PENDING");
  });
});
