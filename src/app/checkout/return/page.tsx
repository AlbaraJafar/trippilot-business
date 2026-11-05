"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { Card } from "@/components/ui";

const STATUS_MESSAGES: Record<string, string> = {
  CAPTURE_PENDING: "PayPal accepted the payment but the capture is still pending. The trip is not marked as paid until PayPal completes it.",
  CAPTURE_UNKNOWN: "We could not confirm the result with PayPal. Do not pay again — open the transaction and reconcile it with PayPal.",
  CAPTURING: "A capture for this payment is already in progress. Do not pay again — open the transaction to check its status.",
  NEEDS_REVIEW: "PayPal returned a capture that did not match this payment. It needs manual review before anything else happens. Do not pay again.",
};

/** PayPal redirects the payer here; the server captures and verifies the order. */
function ReturnInner() {
  const q = useSearchParams();
  const paymentId = q.get("paymentId");
  const token = q.get("token"); // PayPal order id
  const cancelled = q.get("cancelled") === "1";
  const [state, setState] = useState<{ phase: "working" | "ok" | "warn" | "error" | "cancelled"; msg: string; requestId?: string }>({ phase: "working", msg: "Capturing your PayPal payment…" });
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current || !paymentId) return;
    ran.current = true;
    (async () => {
      if (cancelled) {
        await fetch(`/api/payments/${paymentId}/cancel`, { method: "POST" });
        setState({ phase: "cancelled", msg: "Payment cancelled on PayPal. Nothing was charged; the plan remains approved." });
        return;
      }
      const res = await fetch(`/api/payments/${paymentId}/capture`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: token }),
      });
      const j = await res.json().catch(() => ({ error: "The server returned an unreadable response. Open the transaction and reconcile with PayPal; do not pay again." }));
      if (!res.ok) setState({ phase: "error", msg: j.error ?? "Capture failed" });
      else if (j.status === "CAPTURED")
        setState({ phase: "ok", msg: j.alreadyCaptured ? "This payment was already captured and verified. No second capture was made." : "Payment captured and verified by the server (PayPal Sandbox)." });
      else setState({ phase: "warn", msg: STATUS_MESSAGES[j.status] ?? j.message ?? `Payment status: ${j.status}.` });
    })().catch((e) => setState({ phase: "error", msg: (e as Error).message }));
  }, [paymentId, token, cancelled]);

  const Icon = state.phase === "working" ? Loader2 : state.phase === "ok" ? CheckCircle2 : state.phase === "warn" ? AlertTriangle : XCircle;
  const tone = state.phase === "working" ? "animate-spin text-muted" : state.phase === "ok" ? "text-accent" : state.phase === "warn" ? "text-warn" : "text-danger";
  const title = { working: "Finalising payment", ok: "Payment complete", warn: "Payment not yet confirmed", cancelled: "Payment cancelled", error: "Payment problem" }[state.phase];
  return (
    <Card className="mx-auto mt-10 max-w-lg p-8 text-center">
      <Icon className={`mx-auto h-10 w-10 ${tone}`} />
      <h1 className="mt-4 text-lg font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-muted">{state.msg}</p>
      {state.phase === "ok" && (
        <p className="mt-2 text-xs text-muted">Booking status is tracked separately — a captured payment is not a ticket.</p>
      )}
      {state.phase !== "working" && paymentId && (
        <div className="mt-6 flex justify-center gap-3">
          <Link href={`/payments/${paymentId}`} className="inline-flex h-9 items-center rounded-md bg-navy-900 px-4 text-sm font-medium text-white">View transaction</Link>
          <Link href="/requests" className="inline-flex h-9 items-center rounded-md border border-line px-4 text-sm font-medium">Travel requests</Link>
        </div>
      )}
    </Card>
  );
}

export default function CheckoutReturn() {
  return (
    <Suspense>
      <ReturnInner />
    </Suspense>
  );
}
