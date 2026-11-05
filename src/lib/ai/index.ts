import "server-only";
import { AIRPORTS, travelRequirementsSchema, type TravelRequirements } from "../domain/types";
import type { PlanFacts } from "../domain/optimizer";
import { claudeConfigured, claudeText, claudeToolCall } from "./claude";
import { parseInstructionDeterministic } from "./parse-deterministic";
import { explainPlanDeterministic, numbersAreGrounded } from "./explain";

export interface ParsedInstruction {
  requirements: TravelRequirements;
  warnings: string[];
  engine: "CLAUDE" | "DETERMINISTIC";
}

const REQUIREMENTS_JSON_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "Short request title, e.g. 'Riyadh → Jeddah client workshop'" },
    purpose: { type: "string" },
    mode: { type: "string", enum: ["INDIVIDUAL", "GROUP"] },
    origin: { type: "string", description: "IATA airport code" },
    destination: { type: "string", description: "IATA airport code" },
    travelerCount: { type: "integer", minimum: 1 },
    outboundDates: { type: "array", items: { type: "string", description: "YYYY-MM-DD" } },
    returnDates: { type: "array", items: { type: "string", description: "YYYY-MM-DD" } },
    arriveBy: { type: ["string", "null"], description: "HH:MM 24h outbound arrival deadline" },
    earliestDeparture: { type: ["string", "null"], description: "HH:MM earliest outbound departure" },
    returnDepartAfter: { type: ["string", "null"], description: "HH:MM earliest return departure" },
    latestReturn: { type: ["string", "null"], description: "HH:MM latest arrival home" },
    maxPerEmployeeSar: { type: "integer" },
    totalBudgetSar: { type: "integer" },
    preferredAirlines: { type: "array", items: { type: "string", description: "2-letter IATA airline code (SV Saudia, XY flynas, F3 flyadeal)" } },
    baggage: { type: "string", enum: ["ANY", "CABIN", "CHECKED"] },
    directOnly: { type: "boolean" },
    flexibleDates: { type: "boolean" },
    objective: { type: "string", enum: ["CHEAPEST", "BEST_TIMES", "BALANCED", "LOWEST_GROUP_COST", "MOST_COMPLIANT"] },
    warnings: { type: "array", items: { type: "string" }, description: "Ambiguities or assumptions the user must confirm" },
  },
  required: [
    "title", "purpose", "mode", "origin", "destination", "travelerCount", "outboundDates", "returnDates",
    "arriveBy", "earliestDeparture", "returnDepartAfter", "latestReturn", "maxPerEmployeeSar", "totalBudgetSar",
    "preferredAirlines", "baggage", "directOnly", "flexibleDates", "objective", "warnings",
  ],
};

/**
 * Natural language → validated TravelRequirements.
 * Claude extracts; Zod validates; the deterministic parser is the fallback.
 * The result is always shown to the user for confirmation before anything is created.
 */
export async function parseInstruction(text: string, todayISO: string, defaults: { maxPerEmployeeSar: number }): Promise<ParsedInstruction> {
  const fallback = () => ({ ...parseInstructionDeterministic(text, todayISO, defaults), engine: "DETERMINISTIC" as const });
  if (!claudeConfigured()) return fallback();

  const airports = Object.entries(AIRPORTS).map(([c, a]) => `${c}=${a.city}`).join(", ");
  const raw = await claudeToolCall({
    system:
      `You extract corporate travel requirements for TripPilot Business (Saudi Arabia). Today is ${todayISO}. ` +
      `Supported airports: ${airports}. Resolve relative dates (e.g. "Thursday") to the next future occurrence. ` +
      `Dates without a year are the next future occurrence. Budgets are in Saudi riyals (integers). ` +
      `If only a per-employee budget is given, totalBudgetSar = per-employee × travelers; if a value is missing use ${defaults.maxPerEmployeeSar} SAR per employee and add a warning. ` +
      `Never invent constraints the user did not state; use null for absent times. List every assumption in warnings.`,
    prompt: text,
    toolName: "submit_travel_requirements",
    toolDescription: "Submit the structured travel requirements extracted from the instruction.",
    inputSchema: REQUIREMENTS_JSON_SCHEMA,
  });
  if (!raw || typeof raw !== "object") return fallback();
  const { warnings: w, ...rest } = raw as Record<string, unknown>;
  const parsed = travelRequirementsSchema.safeParse(rest);
  if (!parsed.success) {
    const fb = fallback();
    fb.warnings.unshift("Claude's extraction failed validation; used the deterministic parser instead.");
    return fb;
  }
  return { requirements: parsed.data, warnings: Array.isArray(w) ? w.map(String).slice(0, 8) : [], engine: "CLAUDE" };
}

/**
 * Explain a plan. Claude may rephrase, but the text is rejected unless every number
 * in it is derived from the plan facts — otherwise the deterministic text is used.
 */
export async function explainPlan(facts: PlanFacts, label: string): Promise<{ text: string; engine: "CLAUDE" | "DETERMINISTIC" }> {
  const deterministic = explainPlanDeterministic(facts, label);
  if (!claudeConfigured()) return { text: deterministic, engine: "DETERMINISTIC" };
  const text = await claudeText(
    "You are TripPilot's travel analyst. Rewrite the factual summary for a CFO in 2-4 crisp sentences. " +
      "Use ONLY numbers that appear in the facts. Amounts are SAR. Do not add flights, prices or claims. Do not use markdown.",
    `Plan: ${label}\nFacts JSON (money in halalas = SAR×100; convert to SAR when writing):\n${JSON.stringify(facts)}\n\nReference summary:\n${deterministic}`,
  );
  if (text && numbersAreGrounded(text, facts)) return { text, engine: "CLAUDE" };
  return { text: deterministic, engine: "DETERMINISTIC" };
}
