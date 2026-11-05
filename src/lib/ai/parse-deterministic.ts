import { AIRPORTS, type TravelRequirements } from "../domain/types";

/**
 * Deterministic natural-language → structured travel requirements parser.
 * Used when no Anthropic key is configured and as a fallback when Claude's output
 * fails validation. Pure function: same input, same output.
 */

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20,
};
const AIRLINES: Record<string, string> = { saudia: "SV", flynas: "XY", flyadeal: "F3" };

export interface ParseResult {
  requirements: TravelRequirements;
  warnings: string[];
}

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

function toHHMM(h: number, m: number, ampm?: string): string | null {
  let hh = h;
  if (ampm) {
    const a = ampm.toLowerCase();
    if (a.startsWith("p") && hh < 12) hh += 12;
    if (a.startsWith("a") && hh === 12) hh = 0;
  }
  if (hh > 23 || m > 59) return null;
  return `${pad(hh)}:${pad(m)}`;
}

const TIME_RE = /(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)|\b([01]?\d|2[0-3]):([0-5]\d)\b|\b(noon|midday|midnight)\b/i;

function parseTime(s: string): string | null {
  const m = TIME_RE.exec(s);
  if (!m) return null;
  if (m[6]) return m[6].toLowerCase() === "midnight" ? "23:59" : "12:00";
  if (m[3]) return toHHMM(parseInt(m[1], 10), parseInt(m[2] ?? "0", 10), m[3].replace(/\./g, ""));
  return toHHMM(parseInt(m[4], 10), parseInt(m[5], 10));
}

function findDates(seg: string, todayISO: string): string[] {
  const today = new Date(`${todayISO}T12:00:00Z`);
  const out: { pos: number; date: string }[] = [];
  const yearFor = (mo: number, d: number) => {
    const y = today.getUTCFullYear();
    return iso(y, mo, d) < todayISO ? y + 1 : y;
  };
  let m: RegExpExecArray | null;
  const isoRe = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
  while ((m = isoRe.exec(seg))) out.push({ pos: m.index, date: `${m[1]}-${m[2]}-${m[3]}` });
  const md = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/gi;
  while ((m = md.exec(seg))) {
    const mo = MONTHS.indexOf(m[1].toLowerCase()) + 1;
    const d = parseInt(m[2], 10);
    if (d >= 1 && d <= 31) out.push({ pos: m.index, date: iso(yearFor(mo, d), mo, d) });
  }
  const dm = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/gi;
  while ((m = dm.exec(seg))) {
    const mo = MONTHS.indexOf(m[2].toLowerCase()) + 1;
    const d = parseInt(m[1], 10);
    if (d >= 1 && d <= 31) out.push({ pos: m.index, date: iso(yearFor(mo, d), mo, d) });
  }
  const wd = /\b(?:next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/gi;
  while ((m = wd.exec(seg))) {
    const target = WEEKDAYS.indexOf(m[1].toLowerCase());
    const diff = ((target - today.getUTCDay() + 7) % 7) || 7;
    const d = new Date(today.getTime() + diff * 86400000);
    out.push({ pos: m.index, date: iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()) });
  }
  return [...new Set(out.sort((a, b) => a.pos - b.pos).map((x) => x.date))];
}

function amount(s: string): number {
  return parseInt(s.replace(/,/g, ""), 10);
}

export function parseInstructionDeterministic(
  text: string,
  todayISO: string,
  defaults: { maxPerEmployeeSar: number },
): ParseResult {
  const warnings: string[] = [];
  const lower = text.toLowerCase();

  // Airports — "from X to Y" first, otherwise first two mentions in order.
  const mentions: { pos: number; code: string }[] = [];
  for (const [code, a] of Object.entries(AIRPORTS)) {
    for (const alias of a.aliases) {
      const re = new RegExp(`\\b${alias}\\b`, "gi");
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) mentions.push({ pos: m.index, code });
    }
  }
  mentions.sort((a, b) => a.pos - b.pos);
  const uniq = mentions.filter((m, i) => mentions.findIndex((x) => x.code === m.code) === i);
  let origin = uniq[0]?.code ?? "RUH";
  let destination = uniq[1]?.code ?? "JED";
  const fromTo = /from\s+([a-z]+)\s+to\s+([a-z]+)/i.exec(text);
  if (fromTo) {
    const f = Object.entries(AIRPORTS).find(([, a]) => a.aliases.includes(fromTo[1].toLowerCase()))?.[0];
    const t = Object.entries(AIRPORTS).find(([, a]) => a.aliases.includes(fromTo[2].toLowerCase()))?.[0];
    if (f) origin = f;
    if (t) destination = t;
  }
  if (uniq.length < 2) warnings.push("Could not find both origin and destination — defaulted missing values (RUH → JED).");

  // Traveler count
  let travelerCount = 1;
  const cnt = /\b(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)\s+(?:of\s+(?:our|my)\s+)?(?:employees|people|travel+ers|staff|colleagues|consultants|engineers|persons|team members|members|trainers|analysts)\b/i.exec(text);
  if (cnt) travelerCount = /\d/.test(cnt[1]) ? parseInt(cnt[1], 10) : NUMBER_WORDS[cnt[1].toLowerCase()];
  else if (/\b(team|group|everyone|employees)\b/i.test(text)) warnings.push("Group mentioned without a head-count — please confirm travelers.");

  // Split instruction into outbound vs return segments.
  const splitIdx = lower.search(/\b(return(?:ing)?|come back|coming back|fly back|back on|back to)\b/);
  const outSeg = splitIdx >= 0 ? text.slice(0, splitIdx) : text;
  const retSeg = splitIdx >= 0 ? text.slice(splitIdx) : "";

  let outboundDates = findDates(outSeg, todayISO);
  let returnDates = findDates(retSeg, todayISO);
  if (!outboundDates.length && returnDates.length > 1) {
    outboundDates = [returnDates[0]];
    returnDates = returnDates.slice(1);
  }
  if (!outboundDates.length) {
    const d = new Date(Date.parse(`${todayISO}T12:00:00Z`) + 14 * 86400000);
    outboundDates = [iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())];
    warnings.push(`No outbound date found — defaulted to ${outboundDates[0]}.`);
  }
  returnDates = returnDates.filter((d) => d >= outboundDates[0]);

  // Time windows
  const clause = (seg: string, re: RegExp) => {
    const m = re.exec(seg);
    return m ? parseTime(m[0]) : null;
  };
  const T = String.raw`(?:\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)|[01]?\d:[0-5]\d|2[0-3]:[0-5]\d|noon|midday)`;
  const arriveBy = clause(outSeg, new RegExp(String.raw`(?:arrive|arrival|land|be there|reach)[^.;]{0,30}?(?:before|by|no later than)\s*${T}`, "i"));
  let earliestDeparture = clause(outSeg, new RegExp(String.raw`(?:depart|leave|fly|departure)[^.;]{0,20}?(?:after|from|not before)\s*${T}`, "i"));
  let returnDepartAfter = clause(retSeg, new RegExp(String.raw`(?:after|from|not before)\s*${T}`, "i"));
  const latestReturn = clause(retSeg, new RegExp(String.raw`(?:back|home|land|arrive)[^.;]{0,20}?(?:before|by)\s*${T}`, "i"));
  if (!returnDepartAfter && /\bevening\b/i.test(retSeg)) returnDepartAfter = "17:00";
  if (!returnDepartAfter && /\bafternoon\b/i.test(retSeg)) returnDepartAfter = "13:00";
  if (arriveBy && earliestDeparture && earliestDeparture >= arriveBy) {
    warnings.push(`"Depart after ${earliestDeparture}" conflicts with arriving by ${arriveBy} the same day — ignored the departure constraint; please review.`);
    earliestDeparture = null;
  }

  // Budgets
  const per = /(?:sar|sr|riyals?)\s*([\d,]{3,})\s*(?:per|\/|each|a head|for each)|([\d,]{3,})\s*(?:sar|sr|riyals?)\s*(?:per|\/|each|a head)|(?:exceed|over|above|max(?:imum)?|up to|under|below)\s*(?:of\s*)?(?:sar|sr)?\s*([\d,]{3,})\s*(?:sar\s*)?(?:per|each|\/)\s*(?:employee|person|traveler|head|ticket)/i.exec(text);
  const tot = /(?:total|overall|altogether|in total|keep (?:it|the total|everything)?\s*(?:below|under)|budget of|total budget)[^.;\d]{0,25}?(?:sar|sr)?\s*([\d,]{3,})/i.exec(text);
  let maxPerEmployeeSar = per ? amount(per[1] ?? per[2] ?? per[3]) : 0;
  let totalBudgetSar = tot ? amount(tot[1]) : 0;
  if (!maxPerEmployeeSar && totalBudgetSar) maxPerEmployeeSar = Math.floor(totalBudgetSar / travelerCount);
  if (!maxPerEmployeeSar) {
    maxPerEmployeeSar = defaults.maxPerEmployeeSar;
    warnings.push(`No per-employee budget found — using company policy (SAR ${maxPerEmployeeSar}).`);
  }
  if (!totalBudgetSar) totalBudgetSar = maxPerEmployeeSar * travelerCount;

  const preferredAirlines = Object.entries(AIRLINES)
    .filter(([name]) => lower.includes(name))
    .map(([, code]) => code);

  const baggage = /checked (?:bag|luggage|baggage)|hold luggage|with luggage|23 ?kg|20 ?kg/i.test(text)
    ? "CHECKED"
    : /cabin (?:bag|only)|hand luggage|carry[- ]on only/i.test(text)
      ? "CABIN"
      : "ANY";
  const objective = /cheapest|lowest (?:cost|price)/i.test(text)
    ? (travelerCount > 1 ? "LOWEST_GROUP_COST" : "CHEAPEST")
    : /convenien|best times|comfortable/i.test(text)
      ? "BEST_TIMES"
      : /complian/i.test(text)
        ? "MOST_COMPLIANT"
        : "BALANCED";

  const purposeM = /\bfor (?:a |an |the )?((?:client|board|team|project|annual|quarterly|training|site|sales)[^.,;]{2,60})/i.exec(text);
  const city = (c: string) => AIRPORTS[c]?.city ?? c;

  return {
    requirements: {
      title: `${city(origin)} → ${city(destination)} · ${travelerCount > 1 ? `${travelerCount} travelers` : "individual"}`,
      purpose: purposeM ? purposeM[1].trim() : "Business travel (from natural-language instruction)",
      mode: travelerCount > 1 ? "GROUP" : "INDIVIDUAL",
      origin,
      destination,
      travelerCount,
      outboundDates,
      returnDates,
      arriveBy,
      earliestDeparture,
      returnDepartAfter,
      latestReturn,
      maxPerEmployeeSar,
      totalBudgetSar,
      preferredAirlines,
      baggage,
      directOnly: /\bdirect|non[- ]?stop\b/i.test(text),
      flexibleDates: /\bflexib/i.test(text),
      objective,
    },
    warnings,
  };
}
