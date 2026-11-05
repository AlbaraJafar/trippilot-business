import "server-only";
import { prisma } from "./db";
import type { DeptOpt, EmployeeOpt } from "@/components/request-form";

export async function formOptions(companyId: string): Promise<{ employees: EmployeeOpt[]; departments: DeptOpt[] }> {
  const [emps, depts] = await Promise.all([
    prisma.employee.findMany({ where: { companyId, active: true }, include: { department: true }, orderBy: { employeeCode: "asc" } }),
    prisma.department.findMany({ where: { companyId }, orderBy: { name: "asc" } }),
  ]);
  return {
    employees: emps.map((e) => ({
      id: e.id,
      name: e.fullName,
      code: e.employeeCode,
      department: e.department.name,
      departmentId: e.departmentId,
      baggage: e.baggage,
      note: e.earliestDeparture ? `no departures before ${e.earliestDeparture}` : null,
    })),
    departments: depts.map((d) => ({ id: d.id, name: d.name })),
  };
}
