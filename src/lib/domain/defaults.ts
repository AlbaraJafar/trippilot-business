import type { TravelRequirements } from "./types";

/** Shared (server + client) blank request. Lives outside "use client" modules so server pages get the real object. */
export const EMPTY_REQUIREMENTS: TravelRequirements = {
  title: "",
  purpose: "",
  mode: "GROUP",
  origin: "RUH",
  destination: "JED",
  travelerCount: 1,
  outboundDates: [],
  returnDates: [],
  arriveBy: null,
  earliestDeparture: null,
  returnDepartAfter: null,
  latestReturn: null,
  maxPerEmployeeSar: 1200,
  totalBudgetSar: 1200,
  preferredAirlines: [],
  baggage: "ANY",
  directOnly: false,
  flexibleDates: false,
  objective: "BALANCED",
};
