import Link from "next/link";
import { Bot } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { formOptions } from "@/lib/options";
import { loadPolicy } from "@/lib/policy-store";
import { RequestForm } from "@/components/request-form";
import { EMPTY_REQUIREMENTS } from "@/lib/domain/defaults";
import { Empty, PageHeader } from "@/components/ui";

export default async function NewRequestPage() {
  const user = await getCurrentUser();
  if (!user) return <Empty>Seed the database first.</Empty>;
  const [{ employees, departments }, { config }] = await Promise.all([formOptions(user.companyId), loadPolicy(user.companyId)]);
  const isEmployee = user.role === "EMPLOYEE";
  const max = config.standardMaxMinor / 100;
  return (
    <div className="fade-up mx-auto max-w-4xl">
      <PageHeader
        title="Create travel request"
        subtitle={isEmployee ? "Request a trip for yourself. Your travel manager will plan and pay for it." : "Individual or group travel. Every field is validated server-side."}
        actions={
          !isEmployee && (
            <Link href="/agent" className="inline-flex h-9 items-center gap-2 rounded-md border border-line bg-white px-4 text-sm font-medium hover:bg-canvas">
              <Bot className="h-4 w-4" /> Describe it in plain language instead
            </Link>
          )
        }
      />
      <RequestForm
        initial={{ ...EMPTY_REQUIREMENTS, maxPerEmployeeSar: max, totalBudgetSar: max }}
        employees={employees}
        departments={departments}
        lockToEmployeeId={isEmployee ? user.employeeId ?? undefined : undefined}
      />
    </div>
  );
}
