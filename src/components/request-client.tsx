"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ExternalLink, ShieldCheck } from "lucide-react";
import { Badge, Button, Input } from "./ui";
import { postJSON } from "./action-button";

/** When arriving from the AI agent (?autorun=1), immediately search + optimize. */
export function AutoRun({ requestId, shouldRun }: { requestId: string; shouldRun: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const started = useRef(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!shouldRun || params.get("autorun") !== "1" || started.current) return;
    started.current = true;
    setMsg("Agent is searching flights and optimizing the group plan…");
    postJSON(`/api/requests/${requestId}/optimize`)
      .then(() => {
        setMsg(null);
        router.replace(`/requests/${requestId}`);
        router.refresh();
      })
      .catch((e) => setMsg(`Agent run failed: ${(e as Error).message}`));
  }, [shouldRun, params, requestId, router]);
  if (!msg) return null;
  return <div className="mb-4 rounded-md border border-navy-600/20 bg-navy-900/[0.03] px-4 py-3 text-sm">{msg}</div>;
}

interface Preview {
  amountMinor: number;
  chargeCurrency: string;
  chargeAmountMinor: number;
  fx: string;
  lines: { name: string; sarMinor: number; chargeMinor: number }[];
  paypalConfigured: boolean;
  sandbox: boolean;
  currencySupported: boolean;
}

const money = (minor: number, cur: string, dec = false) => {
  const v = minor / 100;
  return `${cur} ${v.toLocaleString("en", { minimumFractionDigits: dec ? 2 : 0, maximumFractionDigits: 2 })}`;
};

/** Step 11: authorised payer reviews the exact server-computed amount and gives explicit consent. */
export function CheckoutPanel({ requestId, canPay }: { requestId: string; canPay: boolean }) {
  const [p, setP] = useState<Preview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/requests/${requestId}/checkout`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error);
        setP(j);
      })
      .catch((e) => setErr((e as Error).message));
  }, [requestId]);

  async function pay() {
    if (!p) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await postJSON<{ approveUrl: string }>(`/api/requests/${requestId}/checkout`, { accepted: true, amountMinor: p.amountMinor });
      window.location.href = r.approveUrl;
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  if (err && !p) return <p className="text-sm text-danger">{err}</p>;
  if (!p) return <p className="text-sm text-muted">Calculating exact amount…</p>;

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-md border border-line">
        <table className="w-full text-sm">
          <tbody>
            {p.lines.map((l) => (
              <tr key={l.name} className="border-b border-line last:border-0">
                <td className="px-3 py-1.5">{l.name}</td>
                <td className="tabular px-3 py-1.5 text-right">{money(l.sarMinor, "SAR")}</td>
                <td className="tabular px-3 py-1.5 text-right text-muted">{money(l.chargeMinor, p.chargeCurrency, true)}</td>
              </tr>
            ))}
            <tr className="bg-canvas font-semibold">
              <td className="px-3 py-2">Total</td>
              <td className="tabular px-3 py-2 text-right">{money(p.amountMinor, "SAR")}</td>
              <td className="tabular px-3 py-2 text-right">{money(p.chargeAmountMinor, p.chargeCurrency, true)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">
        PayPal&apos;s REST APIs do not accept SAR, so the charge is made in {p.chargeCurrency} at {p.fx}. Each line is converted separately with integer
        rounding; the total equals the sum of lines. {p.sandbox && "This is a PayPal Sandbox payment — no real money moves."}
      </p>
      {!p.paypalConfigured ? (
        <div className="rounded-md border border-warn/30 bg-warn-soft px-4 py-3 text-sm text-warn">
          PayPal is not configured. Add <code>PAYPAL_CLIENT_ID</code> and <code>PAYPAL_CLIENT_SECRET</code> from a PayPal Developer <b>Sandbox</b> app to{" "}
          <code>.env</code> and restart. See README → PayPal Sandbox setup.
        </div>
      ) : !canPay ? (
        <p className="text-sm text-muted">Only a travel manager or administrator can authorise payment.</p>
      ) : (
        <>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>
              I authorise TripPilot to create a PayPal {p.sandbox ? "Sandbox " : ""}order for <b>{money(p.chargeAmountMinor, p.chargeCurrency, true)}</b> (
              {money(p.amountMinor, "SAR")}) for this approved travel plan. This consent is recorded separately from the travel approval.
            </span>
          </label>
          <Button variant="accent" disabled={!consent || busy} onClick={pay}>
            <ShieldCheck className="h-4 w-4" /> {busy ? "Creating PayPal order…" : "Continue to PayPal"} <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        </>
      )}
      {err && <p className="text-xs text-danger">{err}</p>}
    </div>
  );
}

export function PriceWatch({ flightOptionId, currentSar }: { flightOptionId: string; currentSar: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState(Math.round(currentSar * 0.92));
  const [msg, setMsg] = useState<string | null>(null);
  if (!open)
    return (
      <button className="text-xs font-medium text-navy-600 hover:underline" onClick={() => setOpen(true)}>
        Watch
      </button>
    );
  return (
    <span className="inline-flex items-center gap-1">
      <Input type="number" className="h-7 w-20 px-2 text-xs" value={target} onChange={(e) => setTarget(parseInt(e.target.value || "0", 10))} />
      <Button
        size="sm"
        variant="secondary"
        onClick={async () => {
          try {
            await postJSON("/api/alerts", { flightOptionId, targetSar: target });
            setOpen(false);
            router.refresh();
          } catch (e) {
            setMsg((e as Error).message);
          }
        }}
      >
        Save
      </Button>
      {msg && <Badge tone="red">{msg}</Badge>}
    </span>
  );
}
