import "server-only";
import type { User } from "@prisma/client";
import { prisma } from "../db";
import { audit } from "../api";
import { HttpError } from "../auth";
import { employeeInputSchema, type EmployeeInput } from "../domain/types";
import { sar } from "../money";

async function resolveRefs(companyId: string, input: EmployeeInput) {
  const dept = await prisma.department.findFirst({ where: { companyId, code: input.departmentCode.toUpperCase() } });
  if (!dept) throw new HttpError(400, `Unknown department code "${input.departmentCode}".`);
  let managerId: string | null = null;
  if (input.managerCode) {
    const m = await prisma.employee.findFirst({ where: { companyId, employeeCode: input.managerCode } });
    if (!m) throw new HttpError(400, `Unknown manager employee ID "${input.managerCode}".`);
    managerId = m.id;
  }
  return { departmentId: dept.id, managerId };
}

function toData(input: EmployeeInput) {
  return {
    employeeCode: input.employeeCode,
    fullName: input.fullName,
    email: input.email,
    jobTitle: input.jobTitle,
    grade: input.grade,
    budgetLimitMinor: sar(input.budgetLimitSar),
    preferredAirline: input.preferredAirline || null,
    preferredDeparture: input.preferredDeparture,
    earliestDeparture: input.earliestDeparture || null,
    baggage: input.baggage,
    seatPreference: input.seatPreference,
    homeAirport: input.homeAirport,
    specialRequirements: input.specialRequirements || null,
  };
}

export async function createEmployee(user: User, raw: unknown) {
  const input = employeeInputSchema.parse(raw);
  const refs = await resolveRefs(user.companyId, input);
  const dupe = await prisma.employee.findFirst({ where: { companyId: user.companyId, OR: [{ employeeCode: input.employeeCode }, { email: input.email }] } });
  if (dupe) throw new HttpError(409, `Employee ID or email already exists (${dupe.employeeCode}).`);
  const e = await prisma.employee.create({ data: { companyId: user.companyId, ...toData(input), ...refs } });
  await audit(user.companyId, user, "EMPLOYEE_CREATED", "Employee", e.id, { code: e.employeeCode });
  return e;
}

export async function updateEmployee(user: User, id: string, raw: unknown) {
  const existing = await prisma.employee.findFirst({ where: { id, companyId: user.companyId } });
  if (!existing) throw new HttpError(404, "Employee not found.");
  const body = raw as { active?: boolean };
  if (typeof body?.active === "boolean" && Object.keys(body).length === 1) {
    const e = await prisma.employee.update({ where: { id }, data: { active: body.active } });
    await audit(user.companyId, user, body.active ? "EMPLOYEE_REACTIVATED" : "EMPLOYEE_DEACTIVATED", "Employee", id, {});
    return e;
  }
  const input = employeeInputSchema.parse(raw);
  const refs = await resolveRefs(user.companyId, input);
  if (refs.managerId === id) throw new HttpError(400, "An employee cannot be their own manager.");
  const e = await prisma.employee.update({ where: { id }, data: { ...toData(input), ...refs } });
  await audit(user.companyId, user, "EMPLOYEE_UPDATED", "Employee", id, {});
  return e;
}

/* ------------------------------------------------------------- CSV import */

const HEADERS = [
  "employeeCode", "fullName", "email", "departmentCode", "jobTitle", "grade", "managerCode", "budgetLimitSar",
  "preferredAirline", "preferredDeparture", "earliestDeparture", "baggage", "seatPreference", "homeAirport", "specialRequirements",
] as const;

export const CSV_TEMPLATE = `${HEADERS.join(",")}\nNS-020,Sami Al-Faraj,sami.alfaraj@northstar.example,CONS,Consultant,STANDARD,NS-013,1200,SV,MORNING,,CHECKED,AISLE,RUH,\n`;

/** Minimal RFC-4180 CSV parser (quoted fields, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

export interface ImportRowResult { row: number; code?: string; ok: boolean; errors: string[] }

export async function importEmployeesCsv(user: User, csv: string, commit: boolean) {
  const rows = parseCsv(csv);
  if (!rows.length) throw new HttpError(400, "CSV is empty.");
  const header = rows[0].map((h) => h.trim());
  const missing = HEADERS.filter((h) => ["employeeCode", "fullName", "email", "departmentCode", "jobTitle", "budgetLimitSar"].includes(h) && !header.includes(h));
  if (missing.length) throw new HttpError(400, `Missing required column(s): ${missing.join(", ")}`);
  if (rows.length > 501) throw new HttpError(400, "Maximum 500 rows per import.");

  const results: ImportRowResult[] = [];
  const valid: { input: EmployeeInput; row: number }[] = [];
  const seenCodes = new Set<string>();
  const seenEmails = new Set<string>();
  for (let i = 1; i < rows.length; i++) {
    const obj: Record<string, string | null> = {};
    header.forEach((h, j) => (obj[h] = (rows[i][j] ?? "").trim() || null));
    const parsed = employeeInputSchema.safeParse({
      ...obj,
      grade: obj.grade ?? undefined,
      preferredDeparture: obj.preferredDeparture ?? undefined,
      baggage: obj.baggage ?? undefined,
      seatPreference: obj.seatPreference ?? undefined,
      homeAirport: obj.homeAirport ?? undefined,
    });
    if (!parsed.success) {
      results.push({ row: i + 1, code: obj.employeeCode ?? undefined, ok: false, errors: parsed.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`) });
      continue;
    }
    const errors: string[] = [];
    const d = parsed.data;
    if (seenCodes.has(d.employeeCode)) errors.push("Duplicate employee ID in file");
    if (seenEmails.has(d.email)) errors.push("Duplicate email in file");
    seenCodes.add(d.employeeCode);
    seenEmails.add(d.email);
    if (await prisma.employee.findFirst({ where: { companyId: user.companyId, OR: [{ employeeCode: d.employeeCode }, { email: d.email }] } }))
      errors.push("Employee ID or email already exists");
    if (!(await prisma.department.findFirst({ where: { companyId: user.companyId, code: d.departmentCode.toUpperCase() } })))
      errors.push(`Unknown department code ${d.departmentCode}`);
    if (d.managerCode && !seenCodes.has(d.managerCode) && !(await prisma.employee.findFirst({ where: { companyId: user.companyId, employeeCode: d.managerCode } })))
      errors.push(`Unknown manager ${d.managerCode}`);
    results.push({ row: i + 1, code: d.employeeCode, ok: errors.length === 0, errors });
    if (!errors.length) valid.push({ input: d, row: i + 1 });
  }

  let imported = 0;
  if (commit && valid.length && results.every((r) => r.ok)) {
    await prisma.$transaction(async (tx) => {
      for (const { input } of valid) {
        const dept = await tx.department.findFirstOrThrow({ where: { companyId: user.companyId, code: input.departmentCode.toUpperCase() } });
        await tx.employee.create({ data: { companyId: user.companyId, ...toData(input), departmentId: dept.id } });
      }
      for (const { input } of valid) {
        if (!input.managerCode) continue;
        const m = await tx.employee.findFirstOrThrow({ where: { companyId: user.companyId, employeeCode: input.managerCode } });
        await tx.employee.updateMany({ where: { companyId: user.companyId, employeeCode: input.employeeCode }, data: { managerId: m.id } });
      }
    });
    imported = valid.length;
    await audit(user.companyId, user, "EMPLOYEES_IMPORTED", "Employee", "csv", { count: imported });
  }
  return { results, validCount: valid.length, errorCount: results.filter((r) => !r.ok).length, imported };
}
