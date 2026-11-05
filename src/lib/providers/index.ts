import { DemoFlightProvider } from "./demo";
import { DuffelFlightProvider } from "./duffel";
import type { FlightProvider } from "./types";

let cached: FlightProvider | null = null;

/** Picks the configured provider. Falls back to DEMO when live credentials are absent. */
export function getFlightProvider(): FlightProvider {
  if (cached) return cached;
  const want = (process.env.FLIGHT_PROVIDER ?? "DEMO").toUpperCase();
  if (want === "DUFFEL" && process.env.DUFFEL_ACCESS_TOKEN) {
    cached = new DuffelFlightProvider(process.env.DUFFEL_ACCESS_TOKEN);
  } else {
    cached = new DemoFlightProvider();
  }
  return cached;
}

export function getProviderById(id: string): FlightProvider {
  if (id === "DUFFEL" && process.env.DUFFEL_ACCESS_TOKEN) return new DuffelFlightProvider(process.env.DUFFEL_ACCESS_TOKEN);
  return new DemoFlightProvider();
}

export type { FlightProvider } from "./types";
