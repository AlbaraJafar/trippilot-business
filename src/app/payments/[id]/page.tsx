import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { ActionButton } from "@/components/action-button";
import { Badge, Card, CardHeader, PageHeader, StatusBadge } from "@/components/ui";

export default async function PaymentDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user || user.role === "EMPLOYEE") notFound();
  const p = await prisma.payment.findFirst({
    where: { id, request: { companyId: user.companyId } },
    include: { request: { include: { bookings: true } }, consentBy: true, events: { orderBy: { createdAt: "asc" } } },
  });
  if (!p) notFound();
  const dt = (d: Date | null) => (d ? d.toLocaleString("en-GB", { timeZone: "Asia/Riyadh", dateStyle: "medium", timeStyle: "medium" }) : "—");
  const rows: [string, React.ReactNode][] = [
    ["Internal transaction ID", <span key="i" className="font-mono text-xs">{p.id}</span>],
    ["Source", p.source === "SEEDED_HISTORY" ? "Historical record (seeded demo data — not a PayPal transaction)" : p.source === "PAYPAL_SANDBOX" ? "PayPal Sandbox (no real money)" : "PayPal Live"],
    ["PayPal order ID", <span key="o" className="font-mono text-xs">{p.paypalOrderId ?? "—"}</span>],
    ["PayPal capture ID", <span key="c" className="font-mono text-xs">{p.paypalCaptureId ?? "—"}</span>],
    ["PayPal refund ID", <span key="r" className="font-mono text-xs">{p.paypalRefundId ?? "—"}</span>],
    ["Travel request", <Link key="t" href={`/requests/${p.requestId}`} className="hover:underline">{p.request.code} · {p.request.title}</Link>],
    ["Business amount", formatMoney(p.amountMinor)],
    ["Charged amount", p.source === "SEEDED_HISTORY" ? "—" : `${formatMoney(p.chargeAmountMinor, p.chargeCurrency, { decimals: true })} · ${p.fxRate}`],
    ["Payer", p.payerEmail ? `${p.payerEmail} (${p.payerId})` : p.payerId ?? "—"],
    ["Payment consent", p.consentBy ? `${p.consentBy.name} · ${dt(p.consentAt)}` : "—"],
    ["Created", dt(p.createdAt)],
    ["Captured", dt(p.capturedAt)],
    ["Refunded", dt(p.refundedAt)],
    ["Booking status", p.request.bookings.length ? [...new Set(p.request.bookings.map((b) => b.status))].join(", ") : "Not started"],
  ];
  return (
    <div className="fade-up">
      <PageHeader
        title="Transaction detail"
        subtitle={<span className="flex items-center gap-2"><StatusBadge status={p.status} /> {p.source !== "SEEDED_HISTORY" && <Badge tone="blue">PayPal {p.source === "PAYPAL_SANDBOX" ? "Sandbox" : ""}</Badge>}</span>}
        actions={
          <>
            {p.paypalOrderId && ["TRAVEL_MANAGER", "ADMIN"].includes(user.role) && <ActionButton url={`/api/payments/${p.id}/sync`} variant="secondary" size="sm">Check status with PayPal</ActionButton>}
            {user.role === "ADMIN" && p.status === "CAPTURED" && p.paypalCaptureId && (
              <ActionButton url={`/api/payments/${p.id}/refund`} body={{ reason: "Trip cancelled (demo refund)" }} variant="danger" size="sm" confirm="Issue a full PayPal Sandbox refund for this capture?">
                Refund via PayPal
              </ActionButton>
            )}
          </>
        }
      />
      {p.errorMessage && <div className="mb-4 rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">{p.errorMessage}</div>}
      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="Payment record" />
          <dl className="divide-y divide-line text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="flex gap-4 px-5 py-2.5"><dt className="w-44 shrink-0 text-muted">{k}</dt><dd className="min-w-0 break-all">{v}</dd></div>
            ))}
          </dl>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Payment history" subtitle="Every state transition is persisted" />
          {p.events.length === 0 ? <p className="px-5 py-4 text-sm text-muted">No events (historical record).</p> : (
            <ol className="relative space-y-4 px-5 py-4">
              {p.events.map((e) => (
                <li key={e.id} className="border-l-2 border-line pl-4">
                  <div className="text-xs font-semibold">{e.type.replace(/_/g, " ").toLowerCase()}</div>
                  <div className="text-xs text-muted">{e.message}</div>
                  <div className="tabular text-[11px] text-muted">{dt(e.createdAt)}</div>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </div>
  );
}
