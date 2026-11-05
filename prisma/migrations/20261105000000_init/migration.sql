-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'SAR',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "budgetMinor" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Department_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "employeeId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "User_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "User_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "employeeCode" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "jobTitle" TEXT NOT NULL,
    "grade" TEXT NOT NULL DEFAULT 'STANDARD',
    "managerId" TEXT,
    "budgetLimitMinor" INTEGER NOT NULL,
    "preferredAirline" TEXT,
    "preferredDeparture" TEXT NOT NULL DEFAULT 'ANY',
    "earliestDeparture" TEXT,
    "baggage" TEXT NOT NULL DEFAULT 'CABIN',
    "seatPreference" TEXT NOT NULL DEFAULT 'ANY',
    "homeAirport" TEXT NOT NULL DEFAULT 'RUH',
    "specialRequirements" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Employee_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Employee_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Employee_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Employee" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TravelPolicy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "standardMaxMinor" INTEGER NOT NULL,
    "seniorMaxMinor" INTEGER NOT NULL,
    "executiveMaxMinor" INTEGER NOT NULL,
    "allowedCabins" TEXT NOT NULL DEFAULT 'ECONOMY',
    "preferredAirlines" TEXT NOT NULL DEFAULT '',
    "directPreferred" BOOLEAN NOT NULL DEFAULT true,
    "minAdvanceDays" INTEGER NOT NULL DEFAULT 3,
    "maxTripBudgetMinor" INTEGER NOT NULL,
    "managerApprovalMaxMinor" INTEGER NOT NULL,
    "deptHeadApprovalMaxMinor" INTEGER NOT NULL,
    "groupDeptHeadMinor" INTEGER NOT NULL,
    "autoExecuteMaxMinor" INTEGER NOT NULL DEFAULT 0,
    "scoringWeights" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TravelPolicy_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TravelRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "outboundDates" TEXT NOT NULL,
    "returnDates" TEXT NOT NULL,
    "arriveBy" TEXT,
    "earliestDeparture" TEXT,
    "returnDepartAfter" TEXT,
    "latestReturn" TEXT,
    "maxPerEmployeeMinor" INTEGER NOT NULL,
    "totalBudgetMinor" INTEGER NOT NULL,
    "preferredAirlines" TEXT NOT NULL DEFAULT '',
    "baggage" TEXT NOT NULL DEFAULT 'ANY',
    "directOnly" BOOLEAN NOT NULL DEFAULT false,
    "flexibleDates" BOOLEAN NOT NULL DEFAULT false,
    "objective" TEXT NOT NULL DEFAULT 'BALANCED',
    "nlInstruction" TEXT,
    "parsedBy" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "selectedItineraryId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TravelRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TravelRequest_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TravelRequest_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Traveler" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    CONSTRAINT "Traveler_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "TravelRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Traveler_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FlightOption" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "isDemo" BOOLEAN NOT NULL,
    "providerRef" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "airline" TEXT NOT NULL,
    "airlineName" TEXT NOT NULL,
    "flightNumber" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "departTime" TEXT NOT NULL,
    "arriveTime" TEXT NOT NULL,
    "arriveDayOffset" INTEGER NOT NULL DEFAULT 0,
    "durationMin" INTEGER NOT NULL,
    "stops" INTEGER NOT NULL DEFAULT 0,
    "cabin" TEXT NOT NULL,
    "baggage" TEXT NOT NULL,
    "baggageKg" INTEGER NOT NULL,
    "refundable" BOOLEAN NOT NULL DEFAULT false,
    "seatsLeft" INTEGER NOT NULL,
    "priceMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'SAR',
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FlightOption_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "TravelRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Itinerary" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "strategy" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "totalMinor" INTEGER NOT NULL,
    "baselineMinor" INTEGER NOT NULL,
    "score" INTEGER NOT NULL,
    "policyStatus" TEXT NOT NULL,
    "feasible" BOOLEAN NOT NULL,
    "explanation" TEXT NOT NULL,
    "explainedBy" TEXT NOT NULL,
    "facts" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Itinerary_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "TravelRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ItineraryAssignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "itineraryId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "outboundFlightId" TEXT,
    "returnFlightId" TEXT,
    "priceMinor" INTEGER NOT NULL,
    "score" INTEGER NOT NULL,
    "policyStatus" TEXT NOT NULL,
    "findings" TEXT NOT NULL,
    "unsatisfiedReason" TEXT,
    CONSTRAINT "ItineraryAssignment_itineraryId_fkey" FOREIGN KEY ("itineraryId") REFERENCES "Itinerary" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ItineraryAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ItineraryAssignment_outboundFlightId_fkey" FOREIGN KEY ("outboundFlightId") REFERENCES "FlightOption" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ItineraryAssignment_returnFlightId_fkey" FOREIGN KEY ("returnFlightId") REFERENCES "FlightOption" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "itineraryId" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "requiredRole" TEXT NOT NULL,
    "reasons" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decisionNote" TEXT,
    "decidedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Approval_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "TravelRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Approval_itineraryId_fkey" FOREIGN KEY ("itineraryId") REFERENCES "Itinerary" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Approval_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "itineraryId" TEXT,
    "source" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'SAR',
    "chargeAmountMinor" INTEGER NOT NULL,
    "chargeCurrency" TEXT NOT NULL,
    "fxRate" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "paypalOrderId" TEXT,
    "paypalCaptureId" TEXT,
    "paypalRefundId" TEXT,
    "approveUrl" TEXT,
    "payerId" TEXT,
    "payerEmail" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "consentById" TEXT,
    "consentAt" DATETIME,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "capturedAt" DATETIME,
    "refundedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Payment_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "TravelRequest" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Payment_itineraryId_fkey" FOREIGN KEY ("itineraryId") REFERENCES "Itinerary" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Payment_consentById_fkey" FOREIGN KEY ("consentById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PaymentEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "paymentId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "payload" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaymentEvent_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Booking" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "assignmentId" TEXT,
    "employeeId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "isSimulated" BOOLEAN NOT NULL,
    "reference" TEXT,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Booking_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "TravelRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Booking_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "ItineraryAssignment" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Booking_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PriceAlert" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "flightOptionId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "targetMinor" INTEGER NOT NULL,
    "currentMinor" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "history" TEXT NOT NULL DEFAULT '[]',
    "isSimulated" BOOLEAN NOT NULL,
    "lastCheckedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PriceAlert_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "TravelRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PriceAlert_flightOptionId_fkey" FOREIGN KEY ("flightOptionId") REFERENCES "FlightOption" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PriceAlert_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "userId" TEXT,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "details" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Department_companyId_code_key" ON "Department"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_employeeId_key" ON "User"("employeeId");

-- CreateIndex
CREATE INDEX "Employee_departmentId_idx" ON "Employee"("departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_companyId_employeeCode_key" ON "Employee"("companyId", "employeeCode");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_companyId_email_key" ON "Employee"("companyId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "TravelPolicy_companyId_key" ON "TravelPolicy"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "TravelRequest_code_key" ON "TravelRequest"("code");

-- CreateIndex
CREATE INDEX "TravelRequest_companyId_status_idx" ON "TravelRequest"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Traveler_requestId_employeeId_key" ON "Traveler"("requestId", "employeeId");

-- CreateIndex
CREATE INDEX "FlightOption_requestId_direction_idx" ON "FlightOption"("requestId", "direction");

-- CreateIndex
CREATE UNIQUE INDEX "ItineraryAssignment_itineraryId_employeeId_key" ON "ItineraryAssignment"("itineraryId", "employeeId");

-- CreateIndex
CREATE INDEX "Approval_status_requiredRole_idx" ON "Approval"("status", "requiredRole");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_paypalOrderId_key" ON "Payment"("paypalOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_paypalCaptureId_key" ON "Payment"("paypalCaptureId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_idempotencyKey_key" ON "Payment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Payment_status_idx" ON "Payment"("status");

-- CreateIndex
CREATE INDEX "Payment_requestId_idx" ON "Payment"("requestId");

-- CreateIndex
CREATE INDEX "PaymentEvent_paymentId_idx" ON "PaymentEvent"("paymentId");

-- CreateIndex
CREATE INDEX "Notification_companyId_createdAt_idx" ON "Notification"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_companyId_createdAt_idx" ON "AuditLog"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

