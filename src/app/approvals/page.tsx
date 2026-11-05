import Link from "next/link";
import { getCurrentUser, levelOf } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { LEVEL_LABEL, type PolicyFinding } from "@/lib/domain/types";
import { departmentRemaining } from "@/lib/policy-store";
import { ApprovalActions } from "@/components/approval-actions";
import { Badge, Card, CardHeader, Empty, PageHeader, StatusBadge, Td, Th } from "@/components/ui";

export default async function ApprovalsPage() {
  const user = await getCurrentUser();
  if (!user) return <Empty>Seed the database first.</Empty>;
  const level = levelOf(user.role);
  const pending = await prisma.approval.findMany({
    where: { status: "PENDING", request: { companyId: user.companyId } },
    include: {
      request: { include: { department: true, createdBy: true } },
      itinerary: { include: { assignments: { include: { employee: true, outboundFlight: true, returnFlight: true } } } },
    },
    orderBy: { createdAt: "asc" },
  });
  const history = await prisma.approval.findMany({
    where: { status: { in: ["APPROVED", "REJECTED", "CHANGES_REQUESTED"] }, request: { companyId: user.companyId } },
    include: { request: true, decidedBy: true },
    orderBy: { decidedAt: "desc" },
    take: 12,
  });
  const budgets = new Map<string, Awaited<ReturnType<typeof departmentRemaining>>>();
  for (const a of pending) if (!budgets.has(a.request.departmentId)) budgets.set(a.request.departmentId, await departmentRemaining(a.request.departmentId));

  return (
    <div className="fade-up">
      <PageHeader
        title="Approval inbox"
        subtitle={level ? `You can approve up to: ${LEVEL_LABEL[level]}. Higher-level approvals are visible but locked.` : "Employees cannot approve purchases. Switch demo account to an approver."}
      />
      {pending.length === 0 && (
        <Card><Empty>Nothing waiting for approval.</Empty></Card>
      )}
      <div className="space-y-4">
        {pending.map((a) => {
          const b = budgets.get(a.request.departmentId)!;
          const canDecide = level >= a.level;
          return (
            <Card key={a.id}>
              <CardHeader
                title={<Link href={`/requests/${a.requestId}`} className="hover:underline">{a.request.code} · {a.request.title}</Link>}
                subtitle={`${a.request.origin} → ${a.request.destination} · submitted by ${a.request.createdBy.name} · ${a.request.department.name}`}
                action={<Badge tone="amber">Needs {LEVEL_LABEL[a.level]}</Badge>}
              />
              <div className="grid gap-5 p-5 xl:grid-cols-3">
                <div className="xl:col-span-2">
                  <div className="overflow-x-auto rounded-md border border-line">
                    <table className="w-full min-w-[560px]">
                      <thead><tr><Th>Employee</Th><Th>Flights</Th><Th className="text-right">Ticket price</Th><Th>Policy</Th></tr></thead>
                      <tbody>
                        {a.itinerary.assignments.map((x) => {
                          const f = (JSON.parse(x.findings) as PolicyFinding[]).filter((y) => y.severity !== "INFO");
                          return (
                            <tr key={x.id}>
                              <Td className="font-medium">{x.employee.fullName}</Td>
                              <Td className="text-xs">{x.outboundFlight?.flightNumber} {x.outboundFlight?.departTime} / {x.returnFlight?.flightNumber} {x.returnFlight?.departTime}</Td>
                              <Td className="tabular text-right">{formatMoney(x.priceMinor)}</Td>
                              <Td>
                                <StatusBadge status={x.policyStatus} />
                                {f.map((y, i) => <div key={i} className="mt-1 max-w-xs text-[11px] text-warn">{y.message}</div>)}
                              </Td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-3 text-xs leading-relaxed text-ink/80"><span className="font-medium">AI explanation:</span> {a.itinerary.explanation}</p>
                </div>
                <div className="space-y-4">
                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    <div><dt className="text-xs text-muted">Total purchase</dt><dd className="tabular text-lg font-semibold">{formatMoney(a.amountMinor)}</dd></div>
                    <div><dt className="text-xs text-muted">Plan policy</dt><dd><StatusBadge status={a.itinerary.policyStatus} /></dd></div>
                    <div><dt className="text-xs text-muted">Dept budget remaining</dt><dd className="tabular font-medium">{formatMoney(b.remainingMinor)}</dd></div>
                    <div><dt className="text-xs text-muted">After purchase</dt><dd className={`tabular font-medium ${b.remainingMinor - a.amountMinor < 0 ? "text-danger" : ""}`}>{formatMoney(b.remainingMinor - a.amountMinor)}</dd></div>
                  </dl>
                  <ul className="space-y-1 text-xs text-muted">
                    {(JSON.parse(a.reasons) as string[]).map((r, i) => <li key={i}>• {r}</li>)}
                  </ul>
                  {canDecide ? <ApprovalActions approvalId={a.id} /> : <p className="text-xs text-warn">Requires {LEVEL_LABEL[a.level]} authority — switch demo account (header) to decide.</p>}
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <Card className="mt-6">
        <CardHeader title="Decision history" />
        {history.length === 0 ? <Empty>No decisions yet.</Empty> : (
          <table className="w-full">
            <thead><tr><Th>Request</Th><Th>Level</Th><Th className="text-right">Amount</Th><Th>Decision</Th><Th>By</Th><Th>When</Th><Th>Note</Th></tr></thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <Td><Link href={`/requests/${h.requestId}`} className="hover:underline">{h.request.code}</Link></Td>
                  <Td className="text-xs">{LEVEL_LABEL[h.level]}</Td>
                  <Td className="tabular text-right">{formatMoney(h.amountMinor)}</Td>
                  <Td><StatusBadge status={h.status} /></Td>
                  <Td className="text-xs">{h.decidedBy?.name ?? "Policy"}</Td>
                  <Td className="tabular text-xs text-muted">{h.decidedAt?.toLocaleString("en-GB", { timeZone: "Asia/Riyadh", dateStyle: "short", timeStyle: "short" })}</Td>
                  <Td className="text-xs text-muted">{h.decisionNote ?? ""}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
