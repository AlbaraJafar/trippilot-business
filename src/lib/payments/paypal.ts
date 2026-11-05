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
    /** false when the failure happened before the API request itself was sent (e.g. obtaining a token). */
    public requestSent = true,
  ) {
    super(message);
  }
}

/** The request may have reached PayPal, but no response arrived (timeout, connection reset, DNS…). */
export class PayPalNetworkError extends Error {
  readonly requestSent = true;
  constructor(message: string, public timedOut: boolean) {
    super(message);
  }
}

/** PayPal answered, but the body could not be read as JSON (or was empty when a body was required). */
export class PayPalUnreadableResponseError extends Error {
  readonly requestSent = true;
  constructor(
    public status: number,
    public debugId: string | undefined,
    public bodySnippet: string,
  ) {
    super(`PayPal returned an unreadable response (HTTP ${status}).`);
  }
}

/**
 * True when we cannot know whether PayPal processed the request: the request was sent and either no
 * response arrived, the response was unreadable, or PayPal reported a server-side (5xx) error.
 * For a capture this means funds MAY have moved, so the caller must reconcile before doing anything else.
 */
export function isOutcomeUnknown(e: unknown): boolean {
  if (e instanceof PayPalNetworkError || e instanceof PayPalUnreadableResponseError) return true;
  if (e instanceof PayPalApiError) return e.requestSent && e.status >= 500;
  if (e instanceof PayPalNotConfiguredError) return false;
  return true; // unexpected error type: assume the worst
}

function timeoutMs() {
  const n = Number(process.env.PAYPAL_HTTP_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 30000;
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
  // Token errors never mean an Orders/Payments request was sent, so they are marked requestSent=false.
  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.secret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs()),
    });
  } catch {
    throw new PayPalApiError(0, "TOKEN_UNAVAILABLE", undefined, "Could not reach PayPal to obtain an access token.", false);
  }
  const debugId = res.headers.get("paypal-debug-id") ?? undefined;
  if (!res.ok) {
    throw new PayPalApiError(res.status, "AUTHENTICATION_FAILURE", debugId, "PayPal authentication failed — check Sandbox client ID/secret.", false);
  }
  let json: { access_token?: string; expires_in?: number };
  try {
    json = (await res.json()) as typeof json;
  } catch {
    throw new PayPalApiError(res.status, "TOKEN_UNREADABLE", debugId, "PayPal returned an unreadable token response.", false);
  }
  if (!json.access_token) throw new PayPalApiError(res.status, "TOKEN_UNREADABLE", debugId, "PayPal token response had no access token.", false);
  tokenCache = { token: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 0) * 1000 };
  return json.access_token;
}

async function call<T>(path: string, init: { method: string; body?: unknown; requestId?: string; prefer?: string }): Promise<T> {
  const cfg = paypalConfig();
  const token = await getAccessToken();
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  if (init.requestId) headers["PayPal-Request-Id"] = init.requestId; // idempotency
  headers["Prefer"] = init.prefer ?? "return=representation";
  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}${path}`, {
      method: init.method,
      headers,
      body: init.body ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs()),
    });
  } catch (e) {
    const timedOut = (e as Error)?.name === "TimeoutError" || (e as Error)?.name === "AbortError";
    throw new PayPalNetworkError(timedOut ? "PayPal did not respond before the timeout." : "Network error while calling PayPal.", timedOut);
  }
  const debugId = res.headers.get("paypal-debug-id") ?? undefined;
  let text: string;
  try {
    text = await res.text();
  } catch {
    throw new PayPalNetworkError("Connection lost while reading PayPal's response.", false);
  }
  let json: Record<string, unknown> & { details?: { issue?: string; description?: string }[]; name?: string; message?: string };
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new PayPalUnreadableResponseError(res.status, debugId, text.slice(0, 300));
  }
  if (!res.ok) {
    const issue = json?.details?.[0]?.issue ?? json?.name;
    const desc = json?.details?.[0]?.description ?? json?.message ?? `PayPal API error ${res.status}`;
    throw new PayPalApiError(res.status, issue, debugId, desc);
  }
  // Every call we make asks for a representation; an empty 2xx body means we do not know the result.
  if (!text) throw new PayPalUnreadableResponseError(res.status, debugId, "");
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
