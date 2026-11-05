import { getCurrentUser } from "@/lib/auth";
import { loadPolicy } from "@/lib/policy-store";
import { PolicyForm } from "@/components/policy-form";
import { Card, CardHeader, Empty, PageHeader } from "@/components/ui";

export default async function PoliciesPage() {
  const user = await getCurrentUser();
  if (!user) return <Empty>Seed the database first.</Empty>;
  const { config: c } = await loadPolicy(user.companyId);
  const s = (m: number) => Math.round(m / 100);
  return (
    <div className="fade-up">
      <PageHeader title="Travel policy" subtitle="A deterministic rules engine evaluates every itinerary. The AI cannot override these rules." />
      <Card className="mb-4">
        <CardHeader title="How evaluation works" />
        <div className="grid gap-4 p-5 text-sm sm:grid-cols-3">
          <div><div className="mb-1 font-medium text-accent">COMPLIANT</div><p className="text-muted">Within grade limit, allowed cabin, booked in advance. Travel manager can approve.</p></div>
          <div><div className="mb-1 font-medium text-warn">REQUIRES_APPROVAL</div><p className="text-muted">Over a fare limit, late booking, or a budget exception. Routed to department head or executive with the exact overage.</p></div>
          <div><div className="mb-1 font-medium text-danger">POLICY_VIOLATION</div><p className="text-muted">Disallowed cabin or a broken hard constraint. Never recommended and cannot be submitted.</p></div>
        </div>
      </Card>
      <PolicyForm
        editable={user.role === "ADMIN"}
        initial={{
          standardMaxSar: s(c.standardMaxMinor),
          seniorMaxSar: s(c.seniorMaxMinor),
          executiveMaxSar: s(c.executiveMaxMinor),
          allowedCabins: c.allowedCabins,
          preferredAirlines: c.preferredAirlines,
          directPreferred: c.directPreferred,
          minAdvanceDays: c.minAdvanceDays,
          maxTripBudgetSar: s(c.maxTripBudgetMinor),
          managerApprovalMaxSar: s(c.managerApprovalMaxMinor),
          deptHeadApprovalMaxSar: s(c.deptHeadApprovalMaxMinor),
          groupDeptHeadSar: s(c.groupDeptHeadMinor),
          autoExecuteMaxSar: s(c.autoExecuteMaxMinor),
          weights: c.weights,
        }}
      />
    </div>
  );
}
