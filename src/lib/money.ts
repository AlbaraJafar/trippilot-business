/**
 * Integer-only money helpers. All amounts are integer minor units
 * (1 SAR = 100 halalas, 1 USD = 100 cents). No floating point arithmetic
 * is used for amounts anywhere in the app.
 */

export const SAR = "SAR";

/** SAR is pegged to USD at 3.75 SAR = 1 USD (Saudi Central Bank peg). */
export const SAR_PER_USD_NUM = 375; // 3.75 expressed as hundredths
export const FX_DESCRIPTION = "3.75 SAR = 1 USD (fixed SAMA peg)";

export function assertMinor(n: number): number {
  if (!Number.isSafeInteger(n)) throw new Error(`Money amount must be an integer minor-unit value, got ${n}`);
  return n;
}

/** Whole riyals -> halalas. */
export function sar(riyals: number): number {
  return assertMinor(Math.round(riyals) * 100);
}

/** Parse a user-entered decimal string ("1,200.50") into minor units without floats. */
export function parseMoney(input: string | number): number {
  const s = String(input).replace(/[,\s]/g, "").replace(/^(SAR|SR|USD|\$)/i, "");
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) throw new Error(`Invalid money amount: ${input}`);
  const whole = parseInt(m[2], 10);
  const frac = parseInt((m[3] ?? "").padEnd(2, "0") || "0", 10);
  const v = whole * 100 + frac;
  return assertMinor(m[1] ? -v : v);
}

/** Format minor units as "SAR 1,234" (or with decimals when non-zero). */
export function formatMoney(minor: number, currency = SAR, opts: { decimals?: boolean } = {}): string {
  const neg = minor < 0;
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const showDec = opts.decimals ?? frac !== 0;
  const body = showDec ? `${wholeStr}.${frac.toString().padStart(2, "0")}` : wholeStr;
  return `${neg ? "-" : ""}${currency} ${body}`;
}

/** Minor units -> PayPal "value" string ("123.45"). */
export function toDecimalString(minor: number): string {
  assertMinor(minor);
  const neg = minor < 0;
  const abs = Math.abs(minor);
  return `${neg ? "-" : ""}${Math.floor(abs / 100)}.${(abs % 100).toString().padStart(2, "0")}`;
}

/**
 * Convert SAR halalas to USD cents at the 3.75 peg using integer math,
 * rounding half-up: cents = halalas * 100 / 375.
 */
export function sarToUsdCents(halalas: number): number {
  assertMinor(halalas);
  return Math.floor((halalas * 100 * 2 + SAR_PER_USD_NUM) / (SAR_PER_USD_NUM * 2));
}

export function sumMinor(values: number[]): number {
  return values.reduce((a, b) => assertMinor(a + b), 0);
}
