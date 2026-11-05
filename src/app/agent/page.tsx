import { getCurrentUser } from "@/lib/auth";
import { formOptions } from "@/lib/options";
import { claudeConfigured } from "@/lib/ai/claude";
import { AgentConsole } from "@/components/agent-console";
import { Empty, PageHeader } from "@/components/ui";

export default async function AgentPage() {
  const user = await getCurrentUser();
  if (!user) return <Empty>Seed the database first.</Empty>;
  if (!["TRAVEL_MANAGER", "ADMIN"].includes(user.role))
    return (
      <div>
        <PageHeader title="AI Travel Agent" />
        <Empty>The planning agent is available to travel managers and administrators. Switch demo account in the header.</Empty>
      </div>
    );
  const { employees, departments } = await formOptions(user.companyId);
  return (
    <div className="fade-up">
      <PageHeader title="AI Travel Agent" subtitle="One instruction → structured request → optimized, policy-checked group plan." />
      <AgentConsole employees={employees} departments={departments} claude={claudeConfigured()} />
    </div>
  );
}
