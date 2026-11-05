import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { CSV_TEMPLATE } from "@/lib/services/employees";
import { ActionButton } from "@/components/action-button";
import { EmployeeToolbar, type EmployeeRow } from "@/components/employee-manager";
import { Badge, Card, Empty, PageHeader, Td, Th } from "@/components/ui";

export default async function EmployeesPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const user = await getCurrentUser();
  if (!user) return <Empty>Seed the database first.</Empty>;
  const { edit } = await searchParams;
  const [employees, departments] = await Promise.all([
    prisma.employee.findMany({ where: { companyId: user.companyId }, include: { department: true, manager: true }, orderBy: [{ active: "desc" }, { employeeCode: "asc" }] }),
    prisma.department.findMany({ where: { companyId: user.companyId }, orderBy: { name: "asc" } }),
  ]);
  const isAdmin = user.role === "ADMIN";
  const editingRow = edit ? employees.find((e) => e.id === edit) : undefined;
  const editing: EmployeeRow | undefined = editingRow && {
    id: editingRow.id,
    employeeCode: editingRow.employeeCode,
    fullName: editingRow.fullName,
    email: editingRow.email,
    departmentCode: editingRow.department.code,
    jobTitle: editingRow.jobTitle,
    grade: editingRow.grade,
    managerCode: editingRow.manager?.employeeCode ?? "",
    budgetLimitSar: editingRow.budgetLimitMinor / 100,
    preferredAirline: editingRow.preferredAirline ?? "",
    preferredDeparture: editingRow.preferredDeparture,
    earliestDeparture: editingRow.earliestDeparture ?? "",
    baggage: editingRow.baggage,
    seatPreference: editingRow.seatPreference,
    homeAirport: editingRow.homeAirport,
    specialRequirements: editingRow.specialRequirements ?? "",
  };

  return (
    <div className="fade-up">
      <PageHeader title="Employees" subtitle={`${employees.filter((e) => e.active).length} active travelers · preferences feed directly into optimization and policy.`} />
      {isAdmin ? (
        <EmployeeToolbar departments={departments.map((d) => ({ code: d.code, name: d.name }))} template={CSV_TEMPLATE} editing={editing} />
      ) : (
        <p className="mb-4 text-xs text-muted">Read-only — only administrators can add, edit or deactivate employees.</p>
      )}
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[1100px]">
          <thead>
            <tr><Th>ID</Th><Th>Employee</Th><Th>Department</Th><Th>Grade</Th><Th>Manager</Th><Th className="text-right">Budget limit</Th><Th>Preferences</Th><Th>Requirements</Th><Th /></tr>
          </thead>
          <tbody>
            {employees.map((e) => (
              <tr key={e.id} className={e.active ? "" : "opacity-50"}>
                <Td className="tabular text-xs">{e.employeeCode}</Td>
                <Td>
                  <div className="font-medium">{e.fullName} {!e.active && <Badge>inactive</Badge>}</div>
                  <div className="text-[11px] text-muted">{e.jobTitle} · {e.email}</div>
                </Td>
                <Td className="text-xs">{e.department.name}</Td>
                <Td className="text-xs">{e.grade.toLowerCase()}</Td>
                <Td className="text-xs">{e.manager?.fullName ?? "—"}</Td>
                <Td className="tabular text-right">{formatMoney(e.budgetLimitMinor)}</Td>
                <Td className="text-xs text-muted">
                  {[e.preferredAirline && `Airline ${e.preferredAirline}`, e.preferredDeparture !== "ANY" && e.preferredDeparture.toLowerCase(), e.baggage === "CHECKED" ? "checked bag" : "cabin bag", e.seatPreference !== "ANY" && `${e.seatPreference.toLowerCase()} seat`, `home ${e.homeAirport}`].filter(Boolean).join(" · ")}
                </Td>
                <Td className="max-w-[220px] text-xs text-muted">{[e.earliestDeparture && `No departures before ${e.earliestDeparture}`, e.specialRequirements].filter(Boolean).join(" · ") || "—"}</Td>
                <Td className="whitespace-nowrap">
                  {isAdmin && (
                    <span className="flex items-center gap-3">
                      <Link href={`/employees?edit=${e.id}`} className="text-xs font-medium text-navy-600 hover:underline">Edit</Link>
                      <ActionButton url={`/api/employees/${e.id}`} body={{ active: !e.active }} size="sm" variant="ghost">
                        {e.active ? "Deactivate" : "Reactivate"}
                      </ActionButton>
                    </span>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
