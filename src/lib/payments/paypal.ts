import "server-only";

/**
 * PayPal REST client (Orders v2, Payments v2, Webhooks v1) — server-side only.
 * Docs: https://developer.paypal.com/docs/api/orders/v2/
 * The client secret never leaves the server. No call here ever fakes a response:
 * if PayPal is not configured, functions throw PayPalNotConfiguredError.
 */

export class PayPalNotConfiguredError extends Error {
  constructor() {
    super("PayPal is not configured. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET (Sandbox app credentials).");
  }
}

export class PayPalApiError extends Error {
  constructor(
    public status: number,
    public issue: string | undefined,
    public debugId: string | undefined,
    message: string,
  ) {
    super(message);
  }
}

/** Currencies accepted by the PayPal REST APIs (developer.paypal.com/reference/currency-codes). SAR is NOT among them. */
export const PAYPAL_SUPPORTED_CURRENCIES = [
  "AUD", "BRL", "CAD", "CNY", "CZK", "DKK", "EUR", "HKD", "HUF", "ILS", "JPY", "MYR", "MXN", "TWD",
  "NZD", "NOK", "PHP", "PLN", "GBP", "SGD", "SEK", "CHF", "THB", "USD",
] as const;

export function paypalConfig() {
  const clientId = process.env.PAYPAL_CLIENT_ID ?? "";
  const secret = process.env.PAYPAL_CLIENT_SECRET ?? "";
  const baseUrl = (process.env.PAYPAL_BASE_URL || "https://api-m.sandbox.paypal.com").replace(/\/$/, "");
  const chargeCurrency = (process.env.PAYPAL_CHARGE_CURRENCY || "USD").toUpperCase();
  return {
    configured: !!clientId && !!secret,
    clientId,
    secret,
    baseUrl,
    isSandbox: baseUrl.includes("sandbox"),
    chargeCurrency,
    currencySupported: (PAYPAL_SUPPORTED_CURRENCIES as readonly string[]).includes(chargeCurrency),
    webhookId: process.env.PAYPAL_WEBHOOK_ID ?? "",
  };
}

let tokenCache: { token: string; expiresAt: number } | null = null;

export async function getAccessToken(): Promise<string> {
  const cfg = paypalConfig();
  if (!cfg.configured) throw new PayPalNotConfiguredError();
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60000) return tokenCache.token;
  const res = await fetch(`${cfg.baseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  if (!res.ok) {
    throw new PayPalApiError(res.status, "AUTHENTICATION_FAILURE", res.headers.get("paypal-debug-id") ?? undefined, "PayPal authentication failed — check Sandbox client ID/secret.");
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return json.access_token;
}

async function call<T>(path: string, init: { method: string; body?: unknown; requestId?: string; prefer?: string }): Promise<T> {
  const cfg = paypalConfig();
  const token = await getAccessToken();
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  if (init.requestId) headers["PayPal-Request-Id"] = init.requestId; // idempotency
  headers["Prefer"] = init.prefer ?? "return=representation";
  const res = await fetch(`${cfg.baseUrl}${path}`, {
    method: init.method,
    headers,
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const debugId = res.headers.get("paypal-debug-id") ?? undefined;
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const issue = json?.details?.[0]?.issue ?? json?.name;
    const desc = json?.details?.[0]?.description ?? json?.message ?? `PayPal API error ${res.status}`;
    throw new PayPalApiError(res.status, issue, debugId, desc);
  }
  return json as T;
}

export interface PayPalOrder {
  id: string;
  status: "CREATED" | "SAVED" | "APPROVED" | "VOIDED" | "COMPLETED" | "PAYER_ACTION_REQUIRED";
  links: { href: string; rel: string; method: string }[];
  payer?: { payer_id?: string; email_address?: string };
  purchase_units?: {
    reference_id?: string;
    custom_id?: string;
    amount?: { currency_code: string; value: string };
    payments?: {
      captures?: { id: string; status: string; amount: { currency_code: string; value: string }; create_time?: string }[];
      refunds?: { id: string; status: string }[];
    };
  }[];
}

export interface CreateOrderInput {
  requestId: string; // idempotency key (PayPal-Request-Id)
  referenceId: string; // our payment id
  customId: string; // our travel request code
  invoiceId: string;
  description: string;
  currency: string;
  value: string; // decimal string, computed server-side
  items: { name: string; quantity: string; unit_amount: { currency_code: string; value: string }; category: "DIGITAL_GOODS" | "PHYSICAL_GOODS" | "DONATION" }[];
  returnUrl: string;
  cancelUrl: string;
}

export function createOrder(input: CreateOrderInput) {
  return call<PayPalOrder>("/v2/checkout/orders", {
    method: "POST",
    requestId: input.requestId,
    body: {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: input.referenceId,
          custom_id: input.customId,
          invoice_id: input.invoiceId,
          description: input.description.slice(0, 127),
          amount: {
            currency_code: input.currency,
            value: input.value,
            breakdown: { item_total: { currency_code: input.currency, value: input.value } },
          },
          items: input.items,
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: "TripPilot Business (Sandbox)",
            shipping_preference: "NO_SHIPPING",
            user_action: "PAY_NOW",
            return_url: input.returnUrl,
            cancel_url: input.cancelUrl,
          },
        },
      },
    },
  });
}

export function getOrder(orderId: string) {
  return call<PayPalOrder>(`/v2/checkout/orders/${encodeURIComponent(orderId)}`, { method: "GET" });
}

export function captureOrder(orderId: string, idempotencyKey: string) {
  return call<PayPalOrder>(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: "POST",
    requestId: idempotencyKey,
    body: {},
  });
}

export function refundCapture(captureId: string, idempotencyKey: string, amount?: { currency_code: string; value: string }) {
  return call<{ id: string; status: string }>(`/v2/payments/captures/${encodeURIComponent(captureId)}/refund`, {
    method: "POST",
    requestId: idempotencyKey,
    body: amount ? { amount } : {},
  });
}

/** Verifies a webhook via PayPal's verify-webhook-signature endpoint. */
export async function verifyWebhook(headers: Headers, rawBody: string): Promise<boolean> {
  const cfg = paypalConfig();
  if (!cfg.configured || !cfg.webhookId) return false;
  const res = await call<{ verification_status: string }>("/v1/notifications/verify-webhook-signature", {
    method: "POST",
    body: {
      auth_algo: headers.get("paypal-auth-algo"),
      cert_url: headers.get("paypal-cert-url"),
      transmission_id: headers.get("paypal-transmission-id"),
      transmission_sig: headers.get("paypal-transmission-sig"),
      transmission_time: headers.get("paypal-transmission-time"),
      webhook_id: cfg.webhookId,
      webhook_event: JSON.parse(rawBody),
    },
  });
  return res.verification_status === "SUCCESS";
}

export function approveLink(order: PayPalOrder): string | null {
  return order.links.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href ?? null;
}
