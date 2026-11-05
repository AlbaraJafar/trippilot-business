import { z } from "zod";

export const ROLES = ["ADMIN", "TRAVEL_MANAGER", "DEPARTMENT_HEAD", "EMPLOYEE"] as const;
export type Role = (typeof ROLES)[number];

/** Approval authority level per role. 3 = executive. */
export const ROLE_LEVEL: Record<Role, number> = {
  EMPLOYEE: 0,
  TRAVEL_MANAGER: 1,
  DEPARTMENT_HEAD: 2,
  ADMIN: 3,
};
export const LEVEL_ROLE: Record<number, Role> = { 1: "TRAVEL_MANAGER", 2: "DEPARTMENT_HEAD", 3: "ADMIN" };
export const LEVEL_LABEL: Record<number, string> = { 1: "Travel manager", 2: "Department head", 3: "Executive (CFO)" };

export const AIRPORTS: Record<string, { city: string; aliases: string[] }> = {
  RUH: { city: "Riyadh", aliases: ["riyadh", "ruh"] },
  JED: { city: "Jeddah", aliases: ["jeddah", "jedda", "jidda", "jed"] },
  MED: { city: "Madinah", aliases: ["madinah", "medina", "madina", "med"] },
  DMM: { city: "Dammam", aliases: ["dammam", "dmm", "khobar"] },
  AHB: { city: "Abha", aliases: ["abha", "ahb"] },
  TUU: { city: "Tabuk", aliases: ["tabuk", "tuu"] },
  DXB: { city: "Dubai", aliases: ["dubai", "dxb"] },
};

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24h)");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const iata = z.string().regex(/^[A-Z]{3}$/, "3-letter airport code");

/** Structured travel requirements — produced by the form, the deterministic parser, or Claude. */
export const travelRequirementsSchema = z
  .object({
    title: z.string().min(3).max(120),
    purpose: z.string().min(3).max(500),
    mode: z.enum(["INDIVIDUAL", "GROUP"]),
    origin: iata,
    destination: iata,
    travelerCount: z.number().int().min(1).max(200),
    outboundDates: z.array(isoDate).min(1).max(7),
    returnDates: z.array(isoDate).max(7),
    arriveBy: hhmm.nullable(),
    earliestDeparture: hhmm.nullable(),
    returnDepartAfter: hhmm.nullable(),
    latestReturn: hhmm.nullable(),
    maxPerEmployeeSar: z.number().int().min(1).max(100000),
    totalBudgetSar: z.number().int().min(1).max(10000000),
    preferredAirlines: z.array(z.string().regex(/^[A-Z0-9]{2}$/)).max(5),
    baggage: z.enum(["ANY", "CABIN", "CHECKED"]),
    directOnly: z.boolean(),
    flexibleDates: z.boolean(),
    objective: z.enum(["CHEAPEST", "BEST_TIMES", "BALANCED", "LOWEST_GROUP_COST", "MOST_COMPLIANT"]),
  })
  .refine((r) => r.origin !== r.destination, { message: "Origin and destination must differ", path: ["destination"] })
  .refine((r) => r.returnDates.every((d) => r.outboundDates.some((o) => o <= d)), {
    message: "Return dates must be on or after an outbound date",
    path: ["returnDates"],
  });
export type TravelRequirements = z.infer<typeof travelRequirementsSchema>;

export const createRequestSchema = z.object({
  requirements: travelRequirementsSchema,
  employeeIds: z.array(z.string().min(1)).min(1).max(200),
  departmentId: z.string().min(1),
  nlInstruction: z.string().max(2000).optional(),
  parsedBy: z.enum(["CLAUDE", "DETERMINISTIC", "FORM"]).default("FORM"),
});

export const scoringWeightsSchema = z.object({
  price: z.number().int().min(0).max(100),
  departure: z.number().int().min(0).max(100),
  return: z.number().int().min(0).max(100),
  duration: z.number().int().min(0).max(100),
  airline: z.number().int().min(0).max(100),
  baggage: z.number().int().min(0).max(100),
});
export type ScoringWeights = z.infer<typeof scoringWeightsSchema>;
export const DEFAULT_WEIGHTS: ScoringWeights = { price: 40, departure: 20, return: 20, duration: 10, airline: 5, baggage: 5 };

export const employeeInputSchema = z.object({
  employeeCode: z.string().trim().min(2).max(20),
  fullName: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email(),
  departmentCode: z.string().trim().min(1),
  jobTitle: z.string().trim().min(2).max(100),
  grade: z.enum(["STANDARD", "SENIOR", "EXECUTIVE"]).default("STANDARD"),
  managerCode: z.string().trim().optional().nullable(),
  budgetLimitSar: z.coerce.number().int().min(100).max(100000),
  preferredAirline: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^([A-Z0-9]{2})?$/, "2-character airline code")
    .optional()
    .nullable(),
  preferredDeparture: z.enum(["EARLY", "MORNING", "AFTERNOON", "EVENING", "ANY"]).default("ANY"),
  earliestDeparture: hhmm.optional().nullable().or(z.literal("")),
  baggage: z.enum(["CABIN", "CHECKED"]).default("CABIN"),
  seatPreference: z.enum(["AISLE", "WINDOW", "ANY"]).default("ANY"),
  homeAirport: iata.default("RUH"),
  specialRequirements: z.string().trim().max(300).optional().nullable(),
});
export type EmployeeInput = z.infer<typeof employeeInputSchema>;

export type PolicyStatus = "COMPLIANT" | "REQUIRES_APPROVAL" | "POLICY_VIOLATION";

export interface PolicyFinding {
  rule: string;
  severity: "INFO" | "REQUIRES_APPROVAL" | "VIOLATION";
  message: string;
  actual?: string;
  allowed?: string;
  recommendation?: string;
}
