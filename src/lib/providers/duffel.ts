import { SAR_PER_USD_NUM } from "../money";
import type { BookingInput, FlightProvider, FlightSearchQuery, PriceQuote, ProviderBooking, ProviderFlight } from "./types";

/**
 * Duffel adapter (search only in this MVP).
 *
 * Duffel offers a self-serve test mode ("Duffel Airways" sandbox carrier) and a live
 * mode that requires account verification. Order creation is paid from a Duffel
 * balance / card — Duffel does NOT accept PayPal as the settlement method, which is
 * why TripPilot keeps supplier settlement and PayPal checkout as separate concerns.
 *
 * Booking is intentionally not enabled: createBooking throws so that no code path can
 * claim a ticket was issued. Enable it only after implementing Duffel order + payment.
 */

interface DuffelSegment {
  departing_at: string;
  arriving_at: string;
  marketing_carrier: { iata_code: string; name: string };
  marketing_carrier_flight_number: string;
}
interface DuffelOffer {
  id: string;
  total_amount: string;
  total_currency: string;
  owner: { iata_code: string; name: string };
  slices: { segments: DuffelSegment[]; duration?: string }[];
  passengers: { cabin_class?: string; baggages?: { type: string; quantity: number }[] }[];
  conditions?: { refund_before_departure?: { allowed: boolean } | null };
  available_services?: unknown;
}

function minorFromDecimal(v: string): number {
  const [w, f = ""] = v.split(".");
  return parseInt(w, 10) * 100 + parseInt(f.padEnd(2, "0").slice(0, 2), 10);
}

export class DuffelFlightProvider implements FlightProvider {
  readonly id = "DUFFEL";
  readonly label = "Duffel (live API)";
  readonly isLive = true;
  readonly capabilities = { search: true, pricing: true, booking: false, ticketing: false, acceptsPayPal: false };

  constructor(private token: string) {}

  private async call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`https://api.duffel.com${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Duffel-Version": "v2",
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Duffel API ${res.status}`);
    return (await res.json()) as T;
  }

  async searchFlights(q: FlightSearchQuery): Promise<ProviderFlight[]> {
    const results: ProviderFlight[] = [];
    for (const date of q.dates) {
      const body = {
        data: {
          slices: [{ origin: q.origin, destination: q.destination, departure_date: date }],
          passengers: [{ type: "adult" }],
          cabin_class: (q.cabin ?? "ECONOMY").toLowerCase(),
        },
      };
      const r = await this.call<{ data: { offers: DuffelOffer[] } }>(
        "/air/offer_requests?return_offers=true&supplier_timeout=15000",
        { method: "POST", body: JSON.stringify(body) },
      );
      for (const o of r.data.offers.slice(0, 40)) {
        const segs = o.slices[0]?.segments ?? [];
        if (!segs.length) continue;
        let priceMinor: number;
        const amt = minorFromDecimal(o.total_amount);
        if (o.total_currency === "SAR") priceMinor = amt;
        else if (o.total_currency === "USD") priceMinor = Math.round((amt * SAR_PER_USD_NUM) / 100);
        else continue; // unsupported currency: skip rather than guess an FX rate
        const first = segs[0];
        const last = segs[segs.length - 1];
        const dep = first.departing_at.slice(11, 16);
        const arr = last.arriving_at.slice(11, 16);
        const dayOffset = Math.round(
          (Date.parse(last.arriving_at.slice(0, 10)) - Date.parse(first.departing_at.slice(0, 10))) / 86400000,
        );
        const durationMin = Math.max(
          1,
          Math.round((Date.parse(last.arriving_at + "Z") - Date.parse(first.departing_at + "Z")) / 60000),
        );
        const checked = o.passengers[0]?.baggages?.some((b) => b.type === "checked" && b.quantity > 0) ?? false;
        const cabinRaw = (o.passengers[0]?.cabin_class ?? "economy").toUpperCase();
        results.push({
          provider: "DUFFEL",
          isDemo: false,
          providerRef: o.id,
          airline: first.marketing_carrier.iata_code,
          airlineName: first.marketing_carrier.name,
          flightNumber: `${first.marketing_carrier.iata_code} ${first.marketing_carrier_flight_number}`,
          origin: q.origin,
          destination: q.destination,
          date,
          departTime: dep,
          arriveTime: arr,
          arriveDayOffset: dayOffset,
          durationMin,
          stops: segs.length - 1,
          cabin: cabinRaw === "BUSINESS" || cabinRaw === "FIRST" ? "BUSINESS" : cabinRaw === "PREMIUM_ECONOMY" ? "PREMIUM" : "ECONOMY",
          baggage: checked ? "CHECKED" : "CABIN",
          baggageKg: checked ? 23 : 7,
          refundable: !!o.conditions?.refund_before_departure?.allowed,
          seatsLeft: 9, // Duffel does not expose seat inventory on offers
          priceMinor,
          currency: "SAR",
        });
      }
    }
    return results;
  }

  async getFlightDetails(): Promise<ProviderFlight | null> {
    return null;
  }

  async priceFlight(providerRef: string, currentMinor: number): Promise<PriceQuote> {
    const r = await this.call<{ data: { total_amount: string; total_currency: string } }>(`/air/offers/${providerRef}`);
    const amt = minorFromDecimal(r.data.total_amount);
    const priceMinor = r.data.total_currency === "SAR" ? amt : Math.round((amt * SAR_PER_USD_NUM) / 100);
    return { providerRef, priceMinor, previousMinor: currentMinor, changed: priceMinor !== currentMinor, quotedAt: new Date().toISOString(), isSimulated: false };
  }

  async createBooking(input: BookingInput): Promise<ProviderBooking> {
    void input;
    throw new Error("Duffel booking is not enabled in this MVP (requires Duffel order + balance payment).");
  }
  async getBookingStatus(reference: string): Promise<ProviderBooking> {
    return { reference, status: "FAILED", isSimulated: false, message: "Not supported" };
  }
  async cancelBooking(reference: string): Promise<ProviderBooking> {
    return { reference, status: "FAILED", isSimulated: false, message: "Not supported" };
  }
}
