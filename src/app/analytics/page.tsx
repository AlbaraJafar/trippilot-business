import { getCurrentUser } from "@/lib/auth";
import { getAnalytics } from "@/lib/analytics";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { BudgetBars, ComplianceDonut, HorizontalBars, MonthlySpendChart } from "@/components/charts";
import { Card, CardHeader, Empty, PageHeader, Stat, Td, Th } from "@/components/ui";

export default async function AnalyticsPage() {
  const user = await getCurrentUser();
  if (!user) return <Empty>Seed the database first.</Empty>;
  const a = await getAnalytics(user.companyId);
  const routes = await prisma.travelRequest.groupBy({ by: ["origin", "destination"], where: { companyId: user.companyId }, _count: { _all: true } });
  const avgTicket = a.kpis.trips ? Math.round(a.kpis.totalSpendMinor / Math.max(1, a.kpis.trips)) : 0;
  return (
    <div className="fade-up">
      <PageHeader title="Analytics" subtitle="Spend, savings, compliance and budget utilisation — computed from ledger and plan records." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total spend" value={formatMoney(a.kpis.totalSpendMinor)} />
        <Stat label="Average spend per trip" value={formatMoney(avgTicket)} />
        <Stat label="Estimated savings" value={formatMoney(a.kpis.savingsMinor)} hint="Baseline = median feasible fare per traveler" />
        <Stat label="PayPal success rate" value={a.kpis.paypalSuccessRate === null ? "—" : `${a.kpis.paypalSuccessRate}%`} hint={`${a.kpis.paypalCount} PayPal orders`} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card><CardHeader title="Monthly travel spending" /><div className="p-4"><MonthlySpendChart data={a.monthly} /></div></Card>
        <Card><CardHeader title="Policy compliance" /><div className="p-5"><ComplianceDonut data={a.compliance} /></div></Card>
        <Card><CardHeader title="Spending by department" /><div className="p-4"><HorizontalBars data={a.byDept} /></div></Card>
        <Card><CardHeader title="Spending by destination" /><div className="p-4"><HorizontalBars data={a.byDestination} color="#0f9d6b" /></div></Card>
        <Card><CardHeader title="Budget utilisation" /><div className="p-5"><BudgetBars data={a.byDept} /></div></Card>
        <Card>
          <CardHeader title="Top routes" subtitle="Requests per route" />
          <table className="w-full">
            <thead><tr><Th>Route</Th><Th className="text-right">Requests</Th></tr></thead>
            <tbody>
              {routes.sort((x, y) => y._count._all - x._count._all).map((r) => (
                <tr key={r.origin + r.destination}><Td>{r.origin} → {r.destination}</Td><Td className="tabular text-right">{r._count._all}</Td></tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
      <p className="mt-4 text-xs text-muted">Includes {formatMoney(a.seededShareMinor)} of seeded historical spend (labelled “Historical (seed)” in the ledger) so trends are visible in a fresh demo.</p>
    </div>
  );
}
