/** Supplier-agnostic flight provider contract. Business logic only depends on this file. */

export interface FlightSearchQuery {
  origin: string;
  destination: string;
  dates: string[]; // YYYY-MM-DD, searched individually
  passengers: number;
  cabin?: "ECONOMY" | "PREMIUM" | "BUSINESS";
}

export interface ProviderFlight {
  provider: string;
  isDemo: boolean;
  providerRef: string; // provider-scoped offer / schedule id
  airline: string;
  airlineName: string;
  flightNumber: string;
  origin: string;
  destination: string;
  date: string;
  departTime: string;
  arriveTime: string;
  arriveDayOffset: number;
  durationMin: number;
  stops: number;
  cabin: "ECONOMY" | "PREMIUM" | "BUSINESS";
  baggage: "CABIN" | "CHECKED";
  baggageKg: number;
  refundable: boolean;
  seatsLeft: number;
  priceMinor: number; // per passenger, SAR halalas
  currency: "SAR";
}

export interface PriceQuote {
  providerRef: string;
  priceMinor: number;
  previousMinor: number;
  changed: boolean;
  quotedAt: string;
  isSimulated: boolean;
}

export interface BookingInput {
  providerRef: string;
  passengerName: string;
  passengerEmail: string;
}

export interface ProviderBooking {
  reference: string;
  status: "SIMULATED_HELD" | "SIMULATED_CONFIRMED" | "CANCELLED" | "HELD" | "TICKETED" | "FAILED";
  isSimulated: boolean;
  message: string;
}

export interface ProviderCapabilities {
  search: boolean;
  pricing: boolean;
  booking: boolean;
  ticketing: boolean;
  acceptsPayPal: boolean;
}

export interface FlightProvider {
  readonly id: string;
  readonly label: string;
  readonly isLive: boolean;
  readonly capabilities: ProviderCapabilities;
  searchFlights(q: FlightSearchQuery): Promise<ProviderFlight[]>;
  getFlightDetails(providerRef: string): Promise<ProviderFlight | null>;
  priceFlight(providerRef: string, currentMinor: number): Promise<PriceQuote>;
  createBooking(input: BookingInput): Promise<ProviderBooking>;
  getBookingStatus(reference: string): Promise<ProviderBooking>;
  cancelBooking(reference: string): Promise<ProviderBooking>;
}
