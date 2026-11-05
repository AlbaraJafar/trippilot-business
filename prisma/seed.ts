import { PrismaClient } from "@prisma/client";

/**
 * Deterministic demo seed: "Northstar Consulting".
 * Historical spend is marked source = SEEDED_HISTORY and has NO PayPal ids —
 * it is illustrative baseline data, never presented as a PayPal transaction.
 */
const prisma = new PrismaClient();
const SAR = (n: number) => n * 100;

async function main() {
  // wipe (order matters for FKs)
  await prisma.paymentEvent.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.approval.deleteMany();
  await prisma.priceAlert.deleteMany();
  await prisma.itineraryAssignment.deleteMany();
  await prisma.itinerary.deleteMany();
  await prisma.flightOption.deleteMany();
  await prisma.traveler.deleteMany();
  await prisma.travelRequest.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.user.deleteMany();
  await prisma.employee.updateMany({ data: { managerId: null } });
  await prisma.employee.deleteMany();
  await prisma.department.deleteMany();
  await prisma.travelPolicy.deleteMany();
  await prisma.company.deleteMany();

  const company = await prisma.company.create({ data: { name: "Northstar Consulting", currency: "SAR" } });
  const deptDefs = [
    ["CONS", "Consulting", 250000],
    ["ENG", "Engineering", 180000],
    ["SALES", "Sales", 150000],
    ["FIN", "Finance", 80000],
    ["OPS", "Operations & People", 60000],
  ] as const;
  const dept: Record<string, string> = {};
  for (const [code, name, budget] of deptDefs) {
    const d = await prisma.department.create({ data: { companyId: company.id, code, name, budgetMinor: SAR(budget) } });
    dept[code] = d.id;
  }

  await prisma.travelPolicy.create({
    data: {
      companyId: company.id,
      standardMaxMinor: SAR(1200),
      seniorMaxMinor: SAR(2000),
      executiveMaxMinor: SAR(5000),
      allowedCabins: "ECONOMY",
      preferredAirlines: "",
      directPreferred: true,
      minAdvanceDays: 3,
      maxTripBudgetMinor: SAR(50000),
      managerApprovalMaxMinor: SAR(1200),
      deptHeadApprovalMaxMinor: SAR(2000),
      groupDeptHeadMinor: SAR(10000),
      autoExecuteMaxMinor: 0,
      scoringWeights: JSON.stringify({ price: 40, departure: 20, return: 20, duration: 10, airline: 5, baggage: 5 }),
    },
  });

  type E = [code: string, name: string, dept: string, title: string, grade: string, budget: number, airline: string | null, dep: string, bag: string, seat: string, earliest: string | null, special: string | null];
  const leaders: E[] = [
    ["NS-011", "Layla Al-Harbi", "FIN", "Chief Financial Officer", "EXECUTIVE", 5000, "SV", "MORNING", "CHECKED", "AISLE", null, null],
    ["NS-012", "Omar Al-Rashid", "OPS", "Travel Manager", "STANDARD", 1200, null, "ANY", "CABIN", "ANY", null, null],
    ["NS-013", "Faisal Al-Mutairi", "CONS", "Head of Consulting", "SENIOR", 2000, "SV", "MORNING", "CHECKED", "AISLE", null, null],
  ];
  const team: E[] = [
    ["NS-001", "Ahmed Al-Zahrani", "CONS", "Senior Consultant", "STANDARD", 1200, "SV", "MORNING", "CHECKED", "AISLE", null, null],
    ["NS-002", "Noura Al-Shehri", "CONS", "Consultant", "STANDARD", 1200, "XY", "ANY", "CABIN", "WINDOW", null, null],
    ["NS-003", "Khalid Al-Dosari", "CONS", "Principal Consultant", "STANDARD", 1200, null, "ANY", "CHECKED", "AISLE", "07:00", "Medical: cannot take departures before 07:00"],
    ["NS-004", "Reem Al-Otaibi", "ENG", "Data Analyst", "STANDARD", 1200, null, "ANY", "CABIN", "WINDOW", null, null],
    ["NS-005", "Fahad Al-Ghamdi", "ENG", "Field Engineer", "STANDARD", 1200, null, "EARLY", "CHECKED", "ANY", null, "Carries survey equipment (checked bag required)"],
    ["NS-006", "Lama Al-Harthi", "CONS", "Consultant", "STANDARD", 1200, "F3", "ANY", "CABIN", "AISLE", null, null],
    ["NS-007", "Yousef Al-Malki", "SALES", "Sales Lead", "STANDARD", 1200, "SV", "MORNING", "CHECKED", "AISLE", null, null],
    ["NS-008", "Hessa Al-Anazi", "CONS", "Consultant", "STANDARD", 1200, null, "ANY", "CHECKED", "WINDOW", null, null],
    ["NS-009", "Turki Al-Subaie", "ENG", "Software Engineer", "STANDARD", 1200, "XY", "ANY", "CABIN", "ANY", null, null],
    ["NS-010", "Maha Al-Qahtani", "FIN", "Finance Analyst", "STANDARD", 1200, null, "ANY", "CHECKED", "AISLE", null, null],
  ];
  const emp: Record<string, string> = {};
  for (const [code, name, d, title, grade, budget, airline, dep, bag, seat, earliest, special] of [...leaders, ...team]) {
    const e = await prisma.employee.create({
      data: {
        companyId: company.id,
        employeeCode: code,
        fullName: name,
        email: `${name.split(" ")[0].toLowerCase()}.${name.split(" ").slice(1).join("").replace(/-/g, "").toLowerCase()}@northstar.example`,
        departmentId: dept[d],
        jobTitle: title,
        grade,
        budgetLimitMinor: SAR(budget),
        preferredAirline: airline,
        preferredDeparture: dep,
        earliestDeparture: earliest,
        baggage: bag,
        seatPreference: seat,
        homeAirport: "RUH",
        specialRequirements: special,
      },
    });
    emp[code] = e.id;
  }
  for (const [code, , d] of team) {
    await prisma.employee.update({ where: { id: emp[code] }, data: { managerId: d === "CONS" ? emp["NS-013"] : emp["NS-011"] } });
  }

  const admin = await prisma.user.create({ data: { companyId: company.id, name: "Layla Al-Harbi", email: "cfo@northstar.example", role: "ADMIN", title: "CFO · Company administrator", employeeId: emp["NS-011"] } });
  const tm = await prisma.user.create({ data: { companyId: company.id, name: "Omar Al-Rashid", email: "travel@northstar.example", role: "TRAVEL_MANAGER", title: "Travel manager", employeeId: emp["NS-012"] } });
  await prisma.user.create({ data: { companyId: company.id, name: "Faisal Al-Mutairi", email: "faisal@northstar.example", role: "DEPARTMENT_HEAD", title: "Head of Consulting · Approver", employeeId: emp["NS-013"] } });
  await prisma.user.create({ data: { companyId: company.id, name: "Noura Al-Shehri", email: "noura@northstar.example", role: "EMPLOYEE", title: "Consultant · Employee", employeeId: emp["NS-002"] } });

  // ---------- historical spend (SEEDED_HISTORY, May–Oct 2026) ----------
  const hist: [month: string, deptCode: string, route: [string, string], pax: number, perSar: number, compliant: boolean][] = [
    ["2026-05-12", "CONS", ["RUH", "JED"], 4, 910, true],
    ["2026-05-26", "ENG", ["RUH", "DMM"], 3, 620, true],
    ["2026-06-09", "SALES", ["RUH", "JED"], 2, 1180, true],
    ["2026-06-21", "CONS", ["RUH", "MED"], 5, 760, true],
    ["2026-07-07", "ENG", ["JED", "MED"], 6, 540, true],
    ["2026-07-19", "FIN", ["RUH", "JED"], 2, 1340, false],
    ["2026-08-04", "CONS", ["RUH", "JED"], 8, 980, true],
    ["2026-08-25", "SALES", ["RUH", "DXB"], 3, 1620, false],
    ["2026-09-08", "ENG", ["RUH", "AHB"], 4, 820, true],
    ["2026-09-22", "CONS", ["RUH", "MED"], 6, 790, true],
    ["2026-10-06", "OPS", ["RUH", "JED"], 2, 870, true],
    ["2026-10-20", "CONS", ["RUH", "JED"], 7, 1010, true],
    ["2026-10-28", "SALES", ["RUH", "DMM"], 3, 690, true],
  ];
  let n = 1001;
  for (const [date, d, [o, de], pax, per, compliant] of hist) {
    const code = `TR-${n++}`;
    const total = SAR(per * pax);
    const req = await prisma.travelRequest.create({
      data: {
        code,
        companyId: company.id,
        departmentId: dept[d],
        createdById: tm.id,
        title: `${o} → ${de} ${d.toLowerCase()} trip`,
        purpose: "Historical trip (seeded demo data)",
        mode: pax > 1 ? "GROUP" : "INDIVIDUAL",
        origin: o,
        destination: de,
        outboundDates: JSON.stringify([date]),
        returnDates: JSON.stringify([date]),
        maxPerEmployeeMinor: SAR(1200),
        totalBudgetMinor: SAR(1200 * pax),
        status: "BOOKED",
        parsedBy: "FORM",
        createdAt: new Date(`${date}T08:00:00Z`),
      },
    });
    const it = await prisma.itinerary.create({
      data: {
        requestId: req.id,
        strategy: "BALANCED",
        label: "Historical plan (seeded)",
        totalMinor: total,
        baselineMinor: Math.round((total * 112) / 100 / 100) * 100,
        score: 700,
        policyStatus: compliant ? "COMPLIANT" : "REQUIRES_APPROVAL",
        feasible: true,
        explanation: "Seeded historical plan used for analytics.",
        explainedBy: "DETERMINISTIC",
        facts: "{}",
        createdAt: new Date(`${date}T08:00:00Z`),
      },
    });
    await prisma.travelRequest.update({ where: { id: req.id }, data: { selectedItineraryId: it.id } });
    await prisma.approval.create({
      data: {
        requestId: req.id,
        itineraryId: it.id,
        level: compliant ? 1 : 2,
        requiredRole: compliant ? "TRAVEL_MANAGER" : "DEPARTMENT_HEAD",
        reasons: JSON.stringify([compliant ? "Within policy" : "Fare above SAR 1,200 per employee"]),
        amountMinor: total,
        status: "APPROVED",
        decidedById: compliant ? tm.id : admin.id,
        decidedAt: new Date(`${date}T10:00:00Z`),
        createdAt: new Date(`${date}T09:00:00Z`),
      },
    });
    await prisma.payment.create({
      data: {
        requestId: req.id,
        itineraryId: it.id,
        source: "SEEDED_HISTORY",
        amountMinor: total,
        currency: "SAR",
        chargeAmountMinor: total,
        chargeCurrency: "SAR",
        fxRate: "n/a (historical record)",
        status: "CAPTURED",
        idempotencyKey: `seed-${code}`,
        createdAt: new Date(`${date}T11:00:00Z`),
        capturedAt: new Date(`${date}T11:00:00Z`),
      },
    });
  }

  // ---------- the flagship demo request (DRAFT, ready to search) ----------
  const demo = await prisma.travelRequest.create({
    data: {
      code: `TR-${n++}`,
      companyId: company.id,
      departmentId: dept.CONS,
      createdById: tm.id,
      title: "Jeddah client workshop — Red Sea Logistics",
      purpose: "Two-day on-site strategy workshop with client leadership",
      mode: "GROUP",
      origin: "RUH",
      destination: "JED",
      outboundDates: JSON.stringify(["2027-03-15"]),
      returnDates: JSON.stringify(["2027-03-16"]),
      arriveBy: "10:00",
      earliestDeparture: null,
      returnDepartAfter: "17:00",
      latestReturn: "23:59",
      maxPerEmployeeMinor: SAR(1200),
      totalBudgetMinor: SAR(15000),
      baggage: "ANY",
      directOnly: true,
      flexibleDates: false,
      objective: "BALANCED",
      parsedBy: "FORM",
      status: "DRAFT",
      travelers: { create: team.map(([code]) => ({ employeeId: emp[code] })) },
    },
  });

  await prisma.notification.create({
    data: { companyId: company.id, kind: "REQUEST", title: `New travel request ${demo.code}`, body: "Jeddah client workshop — 10 travelers", link: `/requests/${demo.id}` },
  });
  await prisma.auditLog.create({
    data: { companyId: company.id, actorId: tm.id, actorName: tm.name, action: "REQUEST_CREATED", entity: "TravelRequest", entityId: demo.id, details: JSON.stringify({ code: demo.code }) },
  });

  console.log(`Seeded ${company.name}: ${team.length + leaders.length} employees, ${hist.length} historical trips, demo request ${demo.code}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
