import Link from "next/link";
import { ArrowRight, Bot, Plus } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getAnalytics } from "@/lib/analytics";
import { formatMoney } from "@/lib/money";
import { Card, CardHeader, Empty, PageHeader, Stat, StatusBadge } from "@/components/ui";
import { BudgetBars, ComplianceDonut, HorizontalBars, MonthlySpendChart } from "@/components/charts";

const ACTION_LABEL: Record<string, string> = {
  REQUEST_CREATED: "New travel request",
  FLIGHTS_SEARCHED: "Flight options retrieved",
  AI_PLANS_GENERATED: "AI itinerary recommendation",
  AI_INSTRUCTION_PARSED: "AI parsed instruction",
  PLAN_SUBMITTED: "Plan submitted for approval",
  APPROVAL_APPROVED: "Approval granted",
  APPROVAL_REJECTED: "Approval rejected",
  APPROVAL_CHANGES_REQUESTED: "Changes requested",
  PAYPAL_ORDER_CREATED: "PayPal order created",
  PAYMENT_CAPTURED: "PayPal payment captured",
  PAYMENT_REFUNDED: "Payment refunded",
  SIMULATED_BOOKINGS_CONFIRMED: "Simulated booking confirmed",
  POLICY_UPDATED: "Travel policy updated",
  EMPLOYEE_CREATED: "Employee added",
  EMPLOYEES_IMPORTED: "Employees imported",
  PRICE_ALERT_CREATED: "Price alert created",
};

export default async function Dashboard() {
  const user = await getCurrentUser();
  if (!user) return <Empty>No data. Run <code>npm run setup</code> to seed the demo database.</Empty>;
  const [a, activity, focus] = await Promise.all([
    getAnalytics(user.companyId),
    prisma.auditLog.findMany({ where: { companyId: user.companyId, action: { in: Object.keys(ACTION_LABEL) } }, orderBy: { createdAt: "desc" }, take: 8 }),
    prisma.travelRequest.findFirst({
      where: { companyId: user.companyId, status: { notIn: ["BOOKED", "REFUNDED", "CANCELLED"] } },
      orderBy: { updatedAt: "desc" },
      include: { itineraries: true, _count: { select: { travelers: true } } },
    }),
  ]);
  const plan = focus?.itineraries.find((i) => i.id === focus.selectedItineraryId) ?? focus?.itineraries.find((i) => i.label.includes("Recommended"));
  const exceptions = plan ? (JSON.parse(plan.facts).exceptions ?? []) as { name: string; overMinor: number }[] : [];

  return (
    <div className="fade-up">
      <PageHeader
        title={`Good day, ${user.name.split(" ")[0]}`}
        subtitle="Corporate travel spend, approvals and PayPal payments at a glance."
        actions={
          <>
            <Link href="/agent" className="inline-flex h-9 items-center gap-2 rounded-md border border-line bg-white px-4 text-sm font-medium hover:bg-canvas">
              <Bot className="h-4 w-4" /> Ask the agent
            </Link>
            <Link href="/requests/new" className="inline-flex h-9 items-center gap-2 rounded-md bg-navy-900 px-4 text-sm font-medium text-white hover:bg-navy-800">
              <Plus className="h-4 w-4" /> Create travel plan
            </Link>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Stat label="Total travel spend" value={formatMoney(a.kpis.totalSpendMinor)} hint={a.seededShareMinor ? `incl. ${formatMoney(a.seededShareMinor)} seeded history` : undefined} />
        <Stat label="Trips paid" value={a.kpis.trips} />
        <Stat label="Active requests" value={a.kpis.activeRequests} />
        <Stat label="Pending approvals" value={a.kpis.pendingApprovals} />
        <Stat label="Estimated savings" value={formatMoney(a.kpis.savingsMinor)} hint="vs. median feasible fare" />
        <Stat
          label="PayPal success rate"
          value={a.kpis.paypalSuccessRate === null ? "—" : `${a.kpis.paypalSuccessRate}%`}
          hint={a.kpis.paypalCount ? `${a.kpis.paypalCaptured} of ${a.kpis.paypalCount} sandbox orders` : "No PayPal orders yet"}
        />
      </div>

      {focus && (
        <Card className="mt-4 overflow-hidden">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-3 bg-navy-950 px-5 py-4 text-white">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-white/50">
                {focus.code} · current plan
              </div>
              <div className="mt-0.5 truncate text-sm font-semibold">{focus.title}</div>
              <div className="text-xs text-white/60">{focus._count.travelers} travelers · {focus.origin} → {focus.destination}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-white/50">Plan total</div>
              <div className="tabular text-lg font-semibold">{plan ? formatMoney(plan.totalMinor) : "Not optimized yet"}</div>
            </div>
            {plan && (
              <div>
                <div className="text-[11px] uppercase tracking-wider text-white/50">Savings vs baseline</div>
                <div className="tabular text-lg font-semibold text-emerald-300">{formatMoney(Math.max(0, plan.baselineMinor - plan.totalMinor))}</div>
              </div>
            )}
            {plan && (
              <div>
                <div className="text-[11px] uppercase tracking-wider text-white/50">Policy exceptions</div>
                <div className="text-lg font-semibold">{exceptions.length}</div>
              </div>
            )}
            <div className="ml-auto flex items-center gap-3">
              <StatusBadge status={focus.status} />
              <Link href={`/requests/${focus.id}`} className="inline-flex items-center gap-1 text-sm font-medium text-white hover:underline">
                Open workspace <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
          {exceptions.length > 0 && (
            <div className="px-5 py-3 text-xs text-muted">
              {exceptions.map((e) => `${e.name}: ${e.overMinor ? `+${formatMoney(e.overMinor)} over limit` : "policy note"}`).join(" · ")}
            </div>
          )}
        </Card>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Monthly travel spending" subtitle="Captured payments, last 6 months (SAR)" />
          <div className="p-4"><MonthlySpendChart data={a.monthly} /></div>
        </Card>
        <Card>
          <CardHeader title="Policy compliance" subtitle="Selected plans by status" />
          <div className="p-5"><ComplianceDonut data={a.compliance} /></div>
        </Card>
        <Card>
          <CardHeader title="Spending by department" />
          <div className="p-4"><HorizontalBars data={a.byDept} /></div>
        </Card>
        <Card>
          <CardHeader title="Spending by destination" />
          <div className="p-4"><HorizontalBars data={a.byDestination} color="#0f9d6b" /></div>
        </Card>
        <Card>
          <CardHeader title="Budget utilisation" subtitle="Annual department travel budgets" />
          <div className="p-5"><BudgetBars data={a.byDept} /></div>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="Recent activity" action={<Link href="/notifications" className="text-xs font-medium text-muted hover:text-ink">All notifications</Link>} />
        {activity.length === 0 ? (
          <Empty>No activity yet.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {activity.map((l) => (
              <li key={l.id} className="flex items-center gap-4 px-5 py-3 text-sm">
                <span className="w-44 shrink-0 font-medium">{ACTION_LABEL[l.action] ?? l.action}</span>
                <span className="min-w-0 flex-1 truncate text-muted">{l.actorName}</span>
                <span className="tabular shrink-0 text-xs text-muted">{l.createdAt.toLocaleString("en-GB", { timeZone: "Asia/Riyadh", dateStyle: "medium", timeStyle: "short" })}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
