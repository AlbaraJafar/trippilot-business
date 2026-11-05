import { randomBytes } from "crypto";
import type {
  BookingInput,
  FlightProvider,
  FlightSearchQuery,
  PriceQuote,
  ProviderBooking,
  ProviderFlight,
} from "./types";

/**
 * DEMO FLIGHT PROVIDER
 * --------------------
 * Returns deterministic, SIMULATED schedules and fares. Airline codes are used for
 * realism only — none of these flights, fares or seat counts come from an airline
 * or GDS, and nothing here can be ticketed. Every result carries isDemo = true.
 */

const AIRLINE_NAMES: Record<string, string> = { SV: "Saudia", XY: "flynas", F3: "flyadeal" };

type Tpl = [
  airline: string,
  flightNo: string,
  depart: string,
  durationMin: number,
  baseSar: number,
  cabin: ProviderFlight["cabin"],
  baggage: ProviderFlight["baggage"],
  kg: number,
  stops: number,
  seats: number,
  refundable?: boolean,
];

/** Hand-tuned templates for the flagship demo route so the scenario is repeatable. */
const ROUTE_TEMPLATES: Record<string, Tpl[]> = {
  "RUH-JED": [
    ["SV", "1001", "04:30", 115, 1480, "BUSINESS", "CHECKED", 32, 0, 8, true],
    ["SV", "1020", "05:00", 115, 640, "ECONOMY", "CHECKED", 23, 0, 4],
    ["SV", "1301", "05:20", 255, 470, "ECONOMY", "CHECKED", 23, 1, 9],
    ["XY", "2010", "05:45", 115, 455, "ECONOMY", "CABIN", 7, 0, 6],
    ["F3", "106", "06:30", 115, 520, "ECONOMY", "CHECKED", 20, 0, 5],
    ["SV", "1024", "07:10", 115, 845, "ECONOMY", "CHECKED", 23, 0, 9, true],
    ["XY", "2014", "08:20", 115, 389, "ECONOMY", "CHECKED", 20, 0, 9],
    ["F3", "110", "09:30", 115, 335, "ECONOMY", "CABIN", 7, 0, 12],
    ["SV", "1036", "13:00", 115, 560, "ECONOMY", "CHECKED", 23, 0, 14],
    ["XY", "2020", "16:40", 115, 410, "ECONOMY", "CHECKED", 20, 0, 10],
    ["F3", "114", "18:30", 115, 365, "ECONOMY", "CABIN", 7, 0, 11],
    ["SV", "1042", "20:15", 115, 590, "ECONOMY", "CHECKED", 23, 0, 12],
  ],
  "JED-RUH": [
    ["SV", "1013", "07:00", 110, 610, "ECONOMY", "CHECKED", 23, 0, 12],
    ["XY", "2019", "10:30", 110, 380, "ECONOMY", "CHECKED", 20, 0, 9],
    ["F3", "119", "12:45", 110, 340, "ECONOMY", "CABIN", 7, 0, 10],
    ["XY", "2027", "15:30", 110, 310, "ECONOMY", "CABIN", 7, 0, 9],
    ["F3", "117", "17:30", 110, 395, "ECONOMY", "CABIN", 7, 0, 12],
    ["XY", "2031", "18:15", 110, 470, "ECONOMY", "CHECKED", 20, 0, 6],
    ["SV", "1041", "19:00", 110, 560, "ECONOMY", "CHECKED", 23, 0, 10],
    ["SV", "1003", "20:00", 110, 1350, "BUSINESS", "CHECKED", 32, 0, 8, true],
    ["F3", "121", "21:00", 110, 430, "ECONOMY", "CHECKED", 20, 0, 4],
    ["SV", "1047", "22:30", 115, 505, "ECONOMY", "CHECKED", 23, 0, 14],
  ],
};

/** Approximate block times between demo airports (minutes). */
const BLOCK: Record<string, number> = {
  "RUH-JED": 115, "RUH-MED": 95, "JED-MED": 60, "RUH-DMM": 65, "JED-DMM": 140,
  "RUH-AHB": 105, "JED-AHB": 75, "RUH-TUU": 120, "RUH-DXB": 110, "JED-DXB": 165,
};

/** Weekday fare multipliers (percent), Sunday = 0. Thursday/Sunday are peak business days. */
const WEEKDAY_MULT = [108, 100, 97, 100, 110, 104, 98];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function addMinutes(hhmm: string, mins: number): { time: string; dayOffset: number } {
  const [h, m] = hhmm.split(":").map(Number);
  const total = h * 60 + m + mins;
  const dayOffset = Math.floor(total / 1440);
  const t = total % 1440;
  return { time: `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`, dayOffset };
}

function blockTime(o: string, d: string): number {
  return BLOCK[`${o}-${d}`] ?? BLOCK[`${d}-${o}`] ?? 120;
}

function genericTemplates(o: string, d: string): Tpl[] {
  const dur = blockTime(o, d);
  const base = Math.round(180 + dur * 2.6);
  const slots = ["05:30", "06:45", "08:15", "10:30", "13:20", "16:05", "18:40", "21:10"];
  const airlines = ["SV", "XY", "F3"];
  return slots.map((t, i) => {
    const h = hash(`${o}${d}${t}`);
    const airline = airlines[h % 3];
    const checked = airline === "SV" || h % 2 === 0;
    const price = Math.round(base * (0.8 + ((h >> 3) % 50) / 100) + (airline === "SV" ? 90 : 0));
    return [airline, String(100 + ((h >> 5) % 900)), t, dur, price, "ECONOMY", checked ? "CHECKED" : "CABIN", checked ? (airline === "SV" ? 23 : 20) : 7, 0, 3 + ((h >> 7) % 12), i % 4 === 0] as Tpl;
  });
}

function templatesFor(o: string, d: string): Tpl[] {
  return ROUTE_TEMPLATES[`${o}-${d}`] ?? genericTemplates(o, d);
}

function buildFlight(o: string, d: string, date: string, t: Tpl): ProviderFlight {
  const [airline, no, depart, dur, baseSar, cabin, baggage, kg, stops, seats, refundable] = t;
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const priceSar = Math.round((baseSar * WEEKDAY_MULT[weekday]) / 100);
  const arr = addMinutes(depart, dur);
  return {
    provider: "DEMO",
    isDemo: true,
    providerRef: `DEMO:${o}-${d}:${date}:${airline}${no}`,
    airline,
    airlineName: AIRLINE_NAMES[airline] ?? airline,
    flightNumber: `${airline} ${no}`,
    origin: o,
    destination: d,
    date,
    departTime: depart,
    arriveTime: arr.time,
    arriveDayOffset: arr.dayOffset,
    durationMin: dur,
    stops,
    cabin,
    baggage,
    baggageKg: kg,
    refundable: !!refundable,
    seatsLeft: seats,
    priceMinor: priceSar * 100,
    currency: "SAR",
  };
}

const simulatedBookings = new Map<string, ProviderBooking>();

export class DemoFlightProvider implements FlightProvider {
  readonly id = "DEMO";
  readonly label = "Demo inventory (simulated)";
  readonly isLive = false;
  readonly capabilities = { search: true, pricing: true, booking: true, ticketing: false, acceptsPayPal: false };

  async searchFlights(q: FlightSearchQuery): Promise<ProviderFlight[]> {
    const out: ProviderFlight[] = [];
    for (const date of q.dates) {
      for (const t of templatesFor(q.origin, q.destination)) {
        const f = buildFlight(q.origin, q.destination, date, t);
        if (q.cabin && q.cabin !== f.cabin) continue;
        out.push(f);
      }
    }
    return out.sort((a, b) => (a.date + a.departTime).localeCompare(b.date + b.departTime));
  }

  async getFlightDetails(providerRef: string): Promise<ProviderFlight | null> {
    const m = /^DEMO:([A-Z]{3})-([A-Z]{3}):(\d{4}-\d{2}-\d{2}):([A-Z0-9]{2})(\d+)$/.exec(providerRef);
    if (!m) return null;
    const t = templatesFor(m[1], m[2]).find((x) => x[0] === m[4] && x[1] === m[5]);
    return t ? buildFlight(m[1], m[2], m[3], t) : null;
  }

  /**
   * Simulated fare refresh: deterministic drift of -9%..+6% that changes every
   * 2 minutes. Clearly flagged isSimulated — never presented as an airline fare.
   */
  async priceFlight(providerRef: string, currentMinor: number, now = Date.now()): Promise<PriceQuote> {
    const bucket = Math.floor(now / 120000);
    const h = hash(`${providerRef}:${bucket}`);
    const pct = -9 + (h % 16); // -9..+6
    const base = (await this.getFlightDetails(providerRef))?.priceMinor ?? currentMinor;
    const priceMinor = Math.round((base * (100 + pct)) / 100 / 100) * 100; // whole riyals
    return {
      providerRef,
      priceMinor,
      previousMinor: currentMinor,
      changed: priceMinor !== currentMinor,
      quotedAt: new Date(now).toISOString(),
      isSimulated: true,
    };
  }

  async createBooking(input: BookingInput): Promise<ProviderBooking> {
    // "SIM-" prefix + 8 hex chars: deliberately NOT shaped like a 6-character airline PNR.
    const reference = `SIM-${randomBytes(4).toString("hex").toUpperCase()}`;
    const b: ProviderBooking = {
      reference,
      status: "SIMULATED_HELD",
      isSimulated: true,
      message: `Simulated hold for ${input.passengerName}. No airline reservation exists.`,
    };
    simulatedBookings.set(reference, b);
    return b;
  }

  async getBookingStatus(reference: string): Promise<ProviderBooking> {
    return (
      simulatedBookings.get(reference) ?? {
        reference,
        status: "SIMULATED_HELD",
        isSimulated: true,
        message: "Simulated booking (state persisted in TripPilot database).",
      }
    );
  }

  async cancelBooking(reference: string): Promise<ProviderBooking> {
    const b: ProviderBooking = { reference, status: "CANCELLED", isSimulated: true, message: "Simulated booking cancelled." };
    simulatedBookings.set(reference, b);
    return b;
  }
}
