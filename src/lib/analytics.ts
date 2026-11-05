import "server-only";
import { prisma } from "./db";
import { AIRPORTS } from "./domain/types";

const SPEND_STATUSES = ["CAPTURED"]; // pending captures are not spend until PayPal completes them
const ACTIVE = ["DRAFT", "SEARCHED", "PLANNED", "PENDING_APPROVAL", "CHANGES_REQUESTED", "APPROVED", "PAYMENT_PENDING"];

/** All dashboard figures are computed from database rows — nothing is hard-coded. */
export async function getAnalytics(companyId: string) {
  const [payments, departments, requests, pendingApprovals, selected] = await Promise.all([
    prisma.payment.findMany({ where: { request: { companyId } }, include: { request: { include: { department: true } } } }),
    prisma.department.findMany({ where: { companyId }, orderBy: { name: "asc" } }),
    prisma.travelRequest.findMany({ where: { companyId }, select: { status: true, id: true } }),
    prisma.approval.count({ where: { status: "PENDING", request: { companyId } } }),
    prisma.itinerary.findMany({ where: { request: { companyId, selectedItineraryId: { not: null } } }, include: { request: true } }),
  ]);

  const spent = payments.filter((p) => SPEND_STATUSES.includes(p.status));
  const totalSpendMinor = spent.reduce((a, p) => a + p.amountMinor, 0);
  const paypal = payments.filter((p) => p.source.startsWith("PAYPAL"));
  const ppCaptured = paypal.filter((p) => SPEND_STATUSES.includes(p.status) || p.status === "REFUNDED").length;
  const ppFailed = paypal.filter((p) => p.status === "FAILED").length;
  const paidRequestIds = new Set(spent.map((p) => p.requestId));
  const chosen = selected.filter((i) => i.id === i.request.selectedItineraryId && paidRequestIds.has(i.requestId));
  const savingsMinor = chosen.reduce((a, i) => a + Math.max(0, i.baselineMinor - i.totalMinor), 0);

  // monthly spend, last 6 months (Asia/Riyadh month buckets)
  const months: { key: string; label: string; spendMinor: number }[] = [];
  const now = new Date();
  for (let k = 5; k >= 0; k--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k, 1));
    months.push({ key: d.toISOString().slice(0, 7), label: d.toLocaleString("en", { month: "short", timeZone: "UTC" }), spendMinor: 0 });
  }
  for (const p of spent) {
    const key = new Date((p.capturedAt ?? p.createdAt).getTime() + 3 * 3600000).toISOString().slice(0, 7);
    const m = months.find((x) => x.key === key);
    if (m) m.spendMinor += p.amountMinor;
  }

  const byDept = departments.map((d) => {
    const s = spent.filter((p) => p.request.departmentId === d.id).reduce((a, p) => a + p.amountMinor, 0);
    return { name: d.name, spendMinor: s, budgetMinor: d.budgetMinor, utilisationPct: d.budgetMinor ? Math.round((s * 100) / d.budgetMinor) : 0 };
  });

  const destMap = new Map<string, number>();
  for (const p of spent) {
    const city = AIRPORTS[p.request.destination]?.city ?? p.request.destination;
    destMap.set(city, (destMap.get(city) ?? 0) + p.amountMinor);
  }
  const byDestination = [...destMap.entries()].map(([name, spendMinor]) => ({ name, spendMinor })).sort((a, b) => b.spendMinor - a.spendMinor);

  const compliance = { COMPLIANT: 0, REQUIRES_APPROVAL: 0, POLICY_VIOLATION: 0 } as Record<string, number>;
  for (const i of selected.filter((i) => i.id === i.request.selectedItineraryId)) compliance[i.policyStatus] = (compliance[i.policyStatus] ?? 0) + 1;

  return {
    kpis: {
      totalSpendMinor,
      trips: paidRequestIds.size,
      activeRequests: requests.filter((r) => ACTIVE.includes(r.status)).length,
      pendingApprovals,
      savingsMinor,
      paypalSuccessRate: ppCaptured + ppFailed ? Math.round((ppCaptured * 100) / (ppCaptured + ppFailed)) : null,
      paypalCount: paypal.length,
      paypalCaptured: ppCaptured,
    },
    monthly: months,
    byDept,
    byDestination,
    compliance: Object.entries(compliance).map(([status, count]) => ({ status, count })),
    seededShareMinor: spent.filter((p) => p.source === "SEEDED_HISTORY").reduce((a, p) => a + p.amountMinor, 0),
  };
}
