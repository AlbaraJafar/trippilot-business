import "server-only";
import type { User } from "@prisma/client";
import { prisma } from "../db";
import { audit, notify } from "../api";
import { HttpError, levelOf } from "../auth";
import { getFlightProvider } from "../providers";
import { optimize, recommend, type OptFlight, type OptRequest, type OptTraveler } from "../domain/optimizer";
import { requiredApproval } from "../domain/policy";
import { createRequestSchema, LEVEL_LABEL, LEVEL_ROLE } from "../domain/types";
import { explainPlan } from "../ai";
import { departmentRemaining, loadPolicy, todayISO } from "../policy-store";
import { formatMoney, sar } from "../money";
import type { z } from "zod";

export async function nextRequestCode(): Promise<string> {
  const count = await prisma.travelRequest.count();
  return `TR-${String(1001 + count).padStart(4, "0")}`;
}

export async function createTravelRequest(user: User, input: z.infer<typeof createRequestSchema>) {
  const { requirements: r, employeeIds, departmentId, nlInstruction, parsedBy } = createRequestSchema.parse(input);
  const employees = await prisma.employee.findMany({ where: { id: { in: employeeIds }, companyId: user.companyId, active: true } });
  if (employees.length !== employeeIds.length) throw new HttpError(400, "One or more selected employees are inactive or unknown.");
  const dept = await prisma.department.findFirst({ where: { id: departmentId, companyId: user.companyId } });
  if (!dept) throw new HttpError(400, "Unknown department.");

  const req = await prisma.travelRequest.create({
    data: {
      code: await nextRequestCode(),
      companyId: user.companyId,
      departmentId,
      createdById: user.id,
      title: r.title,
      purpose: r.purpose,
      mode: employees.length > 1 ? "GROUP" : "INDIVIDUAL",
      origin: r.origin,
      destination: r.destination,
      outboundDates: JSON.stringify([...r.outboundDates].sort()),
      returnDates: JSON.stringify([...r.returnDates].sort()),
      arriveBy: r.arriveBy,
      earliestDeparture: r.earliestDeparture,
      returnDepartAfter: r.returnDepartAfter,
      latestReturn: r.latestReturn,
      maxPerEmployeeMinor: sar(r.maxPerEmployeeSar),
      totalBudgetMinor: sar(r.totalBudgetSar),
      preferredAirlines: r.preferredAirlines.join(","),
      baggage: r.baggage,
      directOnly: r.directOnly,
      flexibleDates: r.flexibleDates,
      objective: r.objective,
      nlInstruction: nlInstruction ?? null,
      parsedBy,
      travelers: { create: employees.map((e) => ({ employeeId: e.id })) },
    },
  });
  await audit(user.companyId, user, "REQUEST_CREATED", "TravelRequest", req.id, { code: req.code, travelers: employees.length, parsedBy });
  await notify(user.companyId, { kind: "REQUEST", title: `New travel request ${req.code}`, body: `${r.title} — ${employees.length} traveler(s)`, link: `/requests/${req.id}` });
  return req;
}

async function getRequestForUser(user: User, requestId: string) {
  const req = await prisma.travelRequest.findFirst({ where: { id: requestId, companyId: user.companyId } });
  if (!req) throw new HttpError(404, "Travel request not found.");
  return req;
}

const LOCKED = ["PAYMENT_PENDING", "PAID", "BOOKED", "REFUNDED"];

/** Step 5: query the configured flight provider and persist the options. */
export async function searchFlightsForRequest(user: User, requestId: string) {
  const req = await getRequestForUser(user, requestId);
  if (LOCKED.includes(req.status)) throw new HttpError(409, "Request is already in payment/booking; flights can no longer be re-searched.");
  const provider = getFlightProvider();
  const pax = await prisma.traveler.count({ where: { requestId } });
  const outboundDates: string[] = JSON.parse(req.outboundDates);
  const returnDates: string[] = JSON.parse(req.returnDates);
  const [outs, rets] = await Promise.all([
    provider.searchFlights({ origin: req.origin, destination: req.destination, dates: outboundDates, passengers: pax }),
    returnDates.length
      ? provider.searchFlights({ origin: req.destination, destination: req.origin, dates: returnDates, passengers: pax })
      : Promise.resolve([]),
  ]);

  await prisma.$transaction(async (tx) => {
    await tx.approval.updateMany({ where: { requestId, status: "PENDING" }, data: { status: "SUPERSEDED" } });
    await tx.payment.updateMany({ where: { requestId }, data: { itineraryId: null } });
    await tx.itinerary.deleteMany({ where: { requestId } });
    await tx.priceAlert.deleteMany({ where: { requestId } });
    await tx.flightOption.deleteMany({ where: { requestId } });
    await tx.flightOption.createMany({
      data: [
        ...outs.map((f) => ({ ...f, requestId, direction: "OUTBOUND" })),
        ...rets.map((f) => ({ ...f, requestId, direction: "RETURN" })),
      ],
    });
    await tx.travelRequest.update({ where: { id: requestId }, data: { status: "SEARCHED", selectedItineraryId: null } });
  });
  await audit(user.companyId, user, "FLIGHTS_SEARCHED", "TravelRequest", requestId, {
    provider: provider.id,
    isLive: provider.isLive,
    outbound: outs.length,
    return: rets.length,
  });
  return { provider: provider.id, isLive: provider.isLive, outbound: outs.length, return: rets.length };
}

export function toOptRequest(req: {
  outboundDates: string; returnDates: string; arriveBy: string | null; earliestDeparture: string | null;
  returnDepartAfter: string | null; latestReturn: string | null; maxPerEmployeeMinor: number; totalBudgetMinor: number;
  preferredAirlines: string; baggage: string; directOnly: boolean;
}): OptRequest {
  return {
    outboundDates: JSON.parse(req.outboundDates),
    returnDates: JSON.parse(req.returnDates),
    arriveBy: req.arriveBy,
    earliestDeparture: req.earliestDeparture,
    returnDepartAfter: req.returnDepartAfter,
    latestReturn: req.latestReturn,
    maxPerEmployeeMinor: req.maxPerEmployeeMinor,
    totalBudgetMinor: req.totalBudgetMinor,
    preferredAirlines: req.preferredAirlines.split(",").filter(Boolean),
    baggage: req.baggage,
    directOnly: req.directOnly,
  };
}

/** Steps 6–7: run the optimizer and persist three group plans with explanations. */
export async function optimizeRequest(user: User, requestId: string) {
  const req = await getRequestForUser(user, requestId);
  if (LOCKED.includes(req.status)) throw new HttpError(409, "Request is already in payment/booking.");
  const [flights, travelers, { config }] = await Promise.all([
    prisma.flightOption.findMany({ where: { requestId } }),
    prisma.traveler.findMany({ where: { requestId }, include: { employee: true } }),
    loadPolicy(user.companyId),
  ]);
  if (!flights.length) throw new HttpError(409, "Search flights before optimizing.");

  const optTravelers: OptTraveler[] = travelers.map(({ employee: e }) => ({
    employeeId: e.id,
    name: e.fullName,
    grade: e.grade,
    budgetLimitMinor: e.budgetLimitMinor,
    preferredAirline: e.preferredAirline,
    preferredDeparture: e.preferredDeparture,
    earliestDeparture: e.earliestDeparture,
    baggage: e.baggage,
  }));
  const plans = optimize(optTravelers, flights as OptFlight[], toOptRequest(req), config, todayISO());
  const recommended = recommend(plans);

  const created = [];
  await prisma.approval.updateMany({ where: { requestId, status: "PENDING" }, data: { status: "SUPERSEDED" } });
  await prisma.payment.updateMany({ where: { requestId }, data: { itineraryId: null } });
  await prisma.itinerary.deleteMany({ where: { requestId } });
  for (const p of plans) {
    const exp = await explainPlan(p.facts, p.label);
    const it = await prisma.itinerary.create({
      data: {
        requestId,
        strategy: p.strategy,
        label: p.label + (p.strategy === recommended ? " · Recommended" : ""),
        totalMinor: p.totalMinor,
        baselineMinor: p.baselineMinor,
        score: p.score,
        policyStatus: p.policyStatus,
        feasible: p.feasible,
        explanation: exp.text,
        explainedBy: exp.engine,
        facts: JSON.stringify({ ...p.facts, recommended: p.strategy === recommended }),
        assignments: {
          create: p.assignments.map((a) => ({
            employeeId: a.employeeId,
            outboundFlightId: a.outFlightId,
            returnFlightId: a.retFlightId,
            priceMinor: a.priceMinor,
            score: a.score,
            policyStatus: a.policyStatus,
            findings: JSON.stringify(a.findings),
            unsatisfiedReason: a.unsatisfiedReason,
          })),
        },
      },
    });
    created.push(it);
  }
  await prisma.travelRequest.update({ where: { id: requestId }, data: { status: "PLANNED", selectedItineraryId: null } });
  const rec = plans.find((p) => p.strategy === recommended);
  await audit(user.companyId, null, "AI_PLANS_GENERATED", "TravelRequest", requestId, {
    plans: plans.map((p) => ({ strategy: p.strategy, total: p.totalMinor, feasible: p.feasible, status: p.policyStatus })),
    recommended,
  });
  if (rec)
    await notify(user.companyId, {
      kind: "AI",
      title: `AI recommendation ready for ${req.code}`,
      body: `${rec.label}: ${formatMoney(rec.totalMinor)} for ${rec.facts.travelerCount} traveler(s)`,
      link: `/requests/${requestId}`,
    });
  return { plans: created.map((c) => c.id), recommended };
}

/** Steps 8–10: select a plan, evaluate policy, route the purchase for approval. */
export async function selectItinerary(user: User, requestId: string, itineraryId: string) {
  const req = await getRequestForUser(user, requestId);
  if (LOCKED.includes(req.status)) throw new HttpError(409, "A payment is already in progress for this request.");
  if (!["TRAVEL_MANAGER", "ADMIN"].includes(user.role)) throw new HttpError(403, "Only travel managers or administrators can submit a plan.");
  const it = await prisma.itinerary.findFirst({
    where: { id: itineraryId, requestId },
    include: { assignments: { include: { employee: true } } },
  });
  if (!it) throw new HttpError(404, "Plan not found.");
  if (!it.feasible) throw new HttpError(422, "This plan violates a hard constraint (unrouted travelers or over budget) and cannot be submitted.");
  if (it.policyStatus === "POLICY_VIOLATION") throw new HttpError(422, "This plan contains a policy violation and cannot be submitted.");

  const { config } = await loadPolicy(user.companyId);
  const dept = await departmentRemaining(req.departmentId);
  const reqd = requiredApproval(
    config,
    it.assignments.map((a) => ({ name: a.employee.fullName, priceMinor: a.priceMinor })),
    it.totalMinor,
    dept.remainingMinor,
  );

  await prisma.approval.updateMany({ where: { requestId, status: "PENDING" }, data: { status: "SUPERSEDED" } });
  const auto = reqd.autoExecutable;
  const approval = await prisma.approval.create({
    data: {
      requestId,
      itineraryId,
      level: reqd.level,
      requiredRole: LEVEL_ROLE[reqd.level],
      reasons: JSON.stringify(reqd.reasons),
      amountMinor: it.totalMinor,
      status: auto ? "APPROVED" : "PENDING",
      decidedAt: auto ? new Date() : null,
      decisionNote: auto ? `Auto-approved: total within policy auto-execution limit of ${formatMoney(config.autoExecuteMaxMinor)}.` : null,
    },
  });
  await prisma.travelRequest.update({
    where: { id: requestId },
    data: { selectedItineraryId: itineraryId, status: auto ? "APPROVED" : "PENDING_APPROVAL" },
  });
  await audit(user.companyId, user, "PLAN_SUBMITTED", "TravelRequest", requestId, {
    itineraryId,
    total: it.totalMinor,
    approvalLevel: reqd.level,
    reasons: reqd.reasons,
    autoApproved: auto,
  });
  if (!auto) {
    const approvers = await prisma.user.findMany({ where: { companyId: user.companyId } });
    for (const a of approvers.filter((u) => levelOf(u.role) >= reqd.level)) {
      await notify(user.companyId, {
        userId: a.id,
        kind: "APPROVAL",
        title: `Approval needed: ${req.code}`,
        body: `${formatMoney(it.totalMinor)} · ${LEVEL_LABEL[reqd.level]} sign-off required`,
        link: `/approvals`,
      });
    }
  }
  return { approvalId: approval.id, level: reqd.level, reasons: reqd.reasons, autoApproved: auto };
}

export async function decideApproval(
  user: User,
  approvalId: string,
  decision: "APPROVED" | "REJECTED" | "CHANGES_REQUESTED",
  note: string,
) {
  const ap = await prisma.approval.findUnique({ where: { id: approvalId }, include: { request: true } });
  if (!ap || ap.request.companyId !== user.companyId) throw new HttpError(404, "Approval not found.");
  if (ap.status !== "PENDING") throw new HttpError(409, `This approval is already ${ap.status.toLowerCase()}.`);
  if (levelOf(user.role) < ap.level) throw new HttpError(403, `${LEVEL_LABEL[ap.level]} authority is required for this approval.`);
  if (decision !== "APPROVED" && note.trim().length < 3) throw new HttpError(400, "Please give a reason.");

  const res = await prisma.approval.updateMany({
    where: { id: approvalId, status: "PENDING" },
    data: { status: decision, decidedById: user.id, decidedAt: new Date(), decisionNote: note.trim() || null },
  });
  if (res.count !== 1) throw new HttpError(409, "Approval was decided concurrently.");
  const status = decision === "APPROVED" ? "APPROVED" : decision === "REJECTED" ? "REJECTED" : "CHANGES_REQUESTED";
  await prisma.travelRequest.update({ where: { id: ap.requestId }, data: { status } });
  await audit(user.companyId, user, `APPROVAL_${decision}`, "Approval", approvalId, { requestId: ap.requestId, amount: ap.amountMinor, note });
  await notify(user.companyId, {
    userId: ap.request.createdById,
    kind: "APPROVAL",
    title: `${ap.request.code} ${decision.replace("_", " ").toLowerCase()}`,
    body: `${user.name}: ${note || "Approved for payment."}`,
    link: `/requests/${ap.requestId}`,
  });
}
