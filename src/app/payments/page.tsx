import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { Badge, Button, Card, CardHeader, Empty, Input, Label, PageHeader, Select, Stat, StatusBadge, Td, Th } from "@/components/ui";

type SP = Promise<Record<string, string | undefined>>;

export default async function PaymentsPage({ searchParams }: { searchParams: SP }) {
  const user = await getCurrentUser();
  if (!user) return <Empty>Seed the database first.</Empty>;
  if (user.role === "EMPLOYEE") return <div><PageHeader title="Payments" /><Empty>The transaction ledger is available to finance, approvers and travel managers.</Empty></div>;
  const sp = await searchParams;
  const where: Prisma.PaymentWhereInput = { request: { companyId: user.companyId } };
  if (sp.status) where.status = sp.status;
  if (sp.source) where.source = sp.source;
  if (sp.currency) where.chargeCurrency = sp.currency;
  if (sp.dept) where.request = { companyId: user.companyId, departmentId: sp.dept };
  if (sp.employee) where.itinerary = { assignments: { some: { employeeId: sp.employee } } };
  if (sp.from || sp.to) where.createdAt = { ...(sp.from ? { gte: new Date(`${sp.from}T00:00:00+03:00`) } : {}), ...(sp.to ? { lte: new Date(`${sp.to}T23:59:59+03:00`) } : {}) };

  const [payments, depts, employees, pendingApprovals] = await Promise.all([
    prisma.payment.findMany({
      where,
      include: { request: { include: { department: true } }, itinerary: { include: { assignments: { include: { employee: true } } } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.department.findMany({ where: { companyId: user.companyId }, orderBy: { name: "asc" } }),
    prisma.employee.findMany({ where: { companyId: user.companyId }, orderBy: { fullName: "asc" } }),
    prisma.approval.findMany({ where: { status: "PENDING", request: { companyId: user.companyId } }, include: { request: true } }),
  ]);
  const captured = payments.filter((p) => ["CAPTURED", "CAPTURE_PENDING"].includes(p.status));
  const sum = (xs: typeof payments) => xs.reduce((a, p) => a + p.amountMinor, 0);
  const byDept = new Map<string, number>();
  const byEmp = new Map<string, number>();
  for (const p of captured) {
    byDept.set(p.request.department.name, (byDept.get(p.request.department.name) ?? 0) + p.amountMinor);
    for (const a of p.itinerary?.assignments ?? []) if (a.outboundFlightId) byEmp.set(a.employee.fullName, (byEmp.get(a.employee.fullName) ?? 0) + a.priceMinor);
  }

  return (
    <div className="fade-up">
      <PageHeader title="Payments & transactions" subtitle="PayPal order ledger. Business amounts in SAR; PayPal charge currency shown alongside." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Captured" value={formatMoney(sum(captured))} hint={`${captured.length} payments`} />
        <Stat label="Awaiting payer" value={payments.filter((p) => ["PAYER_ACTION_REQUIRED", "CREATED"].includes(p.status)).length} />
        <Stat label="Pending approvals" value={pendingApprovals.length} hint={formatMoney(pendingApprovals.reduce((a, x) => a + x.amountMinor, 0))} />
        <Stat label="Failed" value={payments.filter((p) => p.status === "FAILED").length} />
        <Stat label="Refunded" value={formatMoney(sum(payments.filter((p) => p.status === "REFUNDED")))} />
      </div>

      <Card className="mt-4">
        <form className="grid grid-cols-2 gap-3 p-4 md:grid-cols-4 lg:grid-cols-7" method="get">
          <div><Label>From</Label><Input type="date" name="from" defaultValue={sp.from} /></div>
          <div><Label>To</Label><Input type="date" name="to" defaultValue={sp.to} /></div>
          <div><Label>Department</Label><Select name="dept" defaultValue={sp.dept ?? ""}><option value="">All</option>{depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></div>
          <div><Label>Employee</Label><Select name="employee" defaultValue={sp.employee ?? ""}><option value="">All</option>{employees.map((e) => <option key={e.id} value={e.id}>{e.fullName}</option>)}</Select></div>
          <div><Label>Status</Label><Select name="status" defaultValue={sp.status ?? ""}><option value="">All</option>{["CAPTURED", "PAYER_ACTION_REQUIRED", "CAPTURE_PENDING", "FAILED", "CANCELLED", "REFUNDED"].map((s) => <option key={s} value={s}>{s.toLowerCase().replace(/_/g, " ")}</option>)}</Select></div>
          <div><Label>Charge currency</Label><Select name="currency" defaultValue={sp.currency ?? ""}><option value="">All</option><option value="USD">USD</option><option value="SAR">SAR</option></Select></div>
          <div className="flex items-end gap-2">
            <Button type="submit" size="sm">Filter</Button>
            <Link href="/payments" className="text-xs text-muted hover:text-ink">Reset</Link>
          </div>
        </form>
      </Card>

      <Card className="mt-4 overflow-x-auto">
        {payments.length === 0 ? <Empty>No transactions match.</Empty> : (
          <table className="w-full min-w-[980px]">
            <thead>
              <tr><Th>Date</Th><Th>Request</Th><Th>Department</Th><Th>Source</Th><Th>PayPal order</Th><Th className="text-right">Amount (SAR)</Th><Th className="text-right">Charged</Th><Th>Status</Th></tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="hover:bg-canvas/60">
                  <Td className="tabular text-xs">{p.createdAt.toLocaleDateString("en-GB", { timeZone: "Asia/Riyadh" })}</Td>
                  <Td><Link href={`/requests/${p.requestId}`} className="hover:underline">{p.request.code}</Link><div className="max-w-[220px] truncate text-[11px] text-muted">{p.request.title}</div></Td>
                  <Td className="text-xs">{p.request.department.name}</Td>
                  <Td>{p.source === "SEEDED_HISTORY" ? <Badge>Historical (seed)</Badge> : <Badge tone="blue">{p.source === "PAYPAL_SANDBOX" ? "PayPal Sandbox" : "PayPal"}</Badge>}</Td>
                  <Td className="font-mono text-[11px]">{p.paypalOrderId ? <Link href={`/payments/${p.id}`} className="hover:underline">{p.paypalOrderId}</Link> : <Link href={`/payments/${p.id}`} className="text-muted hover:underline">view</Link>}</Td>
                  <Td className="tabular text-right">{formatMoney(p.amountMinor)}</Td>
                  <Td className="tabular text-right text-xs text-muted">{p.source === "SEEDED_HISTORY" ? "—" : formatMoney(p.chargeAmountMinor, p.chargeCurrency, { decimals: true })}</Td>
                  <Td><StatusBadge status={p.status} /></Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {[["Amount by department", byDept], ["Amount by employee (PayPal-paid plans)", byEmp]].map(([title, m]) => (
          <Card key={title as string}>
            <CardHeader title={title as string} />
            <ul className="divide-y divide-line text-sm">
              {[...(m as Map<string, number>).entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => (
                <li key={k} className="flex justify-between px-5 py-2"><span>{k}</span><span className="tabular">{formatMoney(v)}</span></li>
              ))}
              {(m as Map<string, number>).size === 0 && <li className="px-5 py-4 text-xs text-muted">No captured payments in this filter.</li>}
            </ul>
          </Card>
        ))}
        <Card>
          <CardHeader title="Amount by travel request" />
          <ul className="divide-y divide-line text-sm">
            {captured.slice(0, 10).map((p) => (
              <li key={p.id} className="flex justify-between px-5 py-2"><Link href={`/requests/${p.requestId}`} className="hover:underline">{p.request.code}</Link><span className="tabular">{formatMoney(p.amountMinor)}</span></li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
