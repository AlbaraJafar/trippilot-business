import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Payment } from "@prisma/client";

/** PayPal client tests with a mocked fetch — verifies request shape, idempotency headers and error mapping. */

beforeEach(() => {
  vi.resetModules();
  process.env.PAYPAL_CLIENT_ID = "test-client";
  process.env.PAYPAL_CLIENT_SECRET = "test-secret";
  process.env.PAYPAL_BASE_URL = "https://api-m.sandbox.paypal.com";
  process.env.PAYPAL_CHARGE_CURRENCY = "USD";
});
afterEach(() => vi.unstubAllGlobals());

function mockFetch(handler: (url: string, init: RequestInit) => { status?: number; body: unknown; headers?: Record<string, string> }) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = handler(url, init);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: r.headers });
  });
  return calls;
}

const tokenResponse = { access_token: "A21-token", expires_in: 3600 };

describe("paypal client", () => {
  it("rejects SAR as charge currency and accepts USD", async () => {
    const { paypalConfig } = await import("@/lib/payments/paypal");
    expect(paypalConfig().currencySupported).toBe(true);
    process.env.PAYPAL_CHARGE_CURRENCY = "SAR";
    expect(paypalConfig().currencySupported).toBe(false);
  });

  it("creates an order with idempotency key, server-computed amount and return URLs", async () => {
    const calls = mockFetch((url) =>
      url.endsWith("/v1/oauth2/token")
        ? { body: tokenResponse }
        : { status: 201, body: { id: "5O190127TN364715T", status: "PAYER_ACTION_REQUIRED", links: [{ rel: "payer-action", href: "https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T", method: "GET" }] } },
    );
    const { createOrder, approveLink } = await import("@/lib/payments/paypal");
    const order = await createOrder({
      requestId: "tp-order-abc",
      referenceId: "pay_1",
      customId: "TR-1014",
      invoiceId: "TR-1014-1",
      description: "TripPilot TR-1014",
      currency: "USD",
      value: "2551.22",
      items: [{ name: "Air travel – A", quantity: "1", unit_amount: { currency_code: "USD", value: "2551.22" }, category: "DIGITAL_GOODS" }],
      returnUrl: "http://localhost:3000/checkout/return?paymentId=pay_1",
      cancelUrl: "http://localhost:3000/checkout/return?paymentId=pay_1&cancelled=1",
    });
    expect(approveLink(order)).toContain("sandbox.paypal.com");
    const tokenCall = calls[0];
    expect(tokenCall.init.headers).toMatchObject({ Authorization: `Basic ${Buffer.from("test-client:test-secret").toString("base64")}` });
    const orderCall = calls[1];
    expect(orderCall.url).toBe("https://api-m.sandbox.paypal.com/v2/checkout/orders");
    const h = orderCall.init.headers as Record<string, string>;
    expect(h["PayPal-Request-Id"]).toBe("tp-order-abc");
    expect(h.Authorization).toBe("Bearer A21-token");
    const body = JSON.parse(orderCall.init.body as string);
    expect(body.intent).toBe("CAPTURE");
    expect(body.purchase_units[0].amount).toMatchObject({ currency_code: "USD", value: "2551.22" });
    expect(body.payment_source.paypal.experience_context.return_url).toContain("/checkout/return");
  });

  it("maps PayPal errors with issue and debug id", async () => {
    mockFetch((url) =>
      url.endsWith("/v1/oauth2/token")
        ? { body: tokenResponse }
        : { status: 422, body: { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "ORDER_NOT_APPROVED", description: "Payer has not yet approved the Order for payment." }] }, headers: { "paypal-debug-id": "dbg123" } },
    );
    const { captureOrder, PayPalApiError } = await import("@/lib/payments/paypal");
    await expect(captureOrder("ORDER1", "tp-capture-1")).rejects.toMatchObject({ issue: "ORDER_NOT_APPROVED", debugId: "dbg123", status: 422 });
    await expect(captureOrder("ORDER1", "tp-capture-1")).rejects.toBeInstanceOf(PayPalApiError);
  });

  it("refuses to call PayPal when not configured", async () => {
    process.env.PAYPAL_CLIENT_ID = "";
    const { getAccessToken, PayPalNotConfiguredError } = await import("@/lib/payments/paypal");
    await expect(getAccessToken()).rejects.toBeInstanceOf(PayPalNotConfiguredError);
  });
});

describe("capture verification", () => {
  const payment = { id: "pay_1", chargeCurrency: "USD", chargeAmountMinor: 255122 } as Payment;
  const order = (value: string, currency = "USD", ref = "pay_1", status = "COMPLETED") => ({
    id: "O1",
    status: "COMPLETED" as const,
    links: [],
    purchase_units: [{ reference_id: ref, payments: { captures: [{ id: "CAP1", status, amount: { currency_code: currency, value } }] } }],
  });

  it("accepts an exact match", async () => {
    const { verifyCapture } = await import("@/lib/services/payments");
    expect(verifyCapture(payment, order("2551.22"))).toMatchObject({ ok: true, captureId: "CAP1", status: "COMPLETED" });
  });
  it("rejects amount, currency or reference mismatches", async () => {
    const { verifyCapture } = await import("@/lib/services/payments");
    expect(verifyCapture(payment, order("2551.21")).ok).toBe(false);
    expect(verifyCapture(payment, order("2551.22", "EUR")).ok).toBe(false);
    expect(verifyCapture(payment, order("2551.22", "USD", "other")).ok).toBe(false);
  });
});
