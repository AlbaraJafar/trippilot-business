-- P0 payment safety: request-level payment slot (activeLock, UNIQUE), capture attempt tracking,
-- review evidence. Generated with `prisma migrate diff`, plus the backfill at the end.

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Payment" (
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
    "activeLock" TEXT,
    "captureAttempts" INTEGER NOT NULL DEFAULT 0,
    "captureStartedAt" DATETIME,
    "reviewEvidence" TEXT,
    "lastReconciledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "capturedAt" DATETIME,
    "refundedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Payment_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "TravelRequest" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Payment_itineraryId_fkey" FOREIGN KEY ("itineraryId") REFERENCES "Itinerary" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Payment_consentById_fkey" FOREIGN KEY ("consentById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Payment" ("amountMinor", "approveUrl", "capturedAt", "chargeAmountMinor", "chargeCurrency", "consentAt", "consentById", "createdAt", "currency", "errorMessage", "fxRate", "id", "idempotencyKey", "itineraryId", "payerEmail", "payerId", "paypalCaptureId", "paypalOrderId", "paypalRefundId", "refundedAt", "requestId", "source", "status", "updatedAt") SELECT "amountMinor", "approveUrl", "capturedAt", "chargeAmountMinor", "chargeCurrency", "consentAt", "consentById", "createdAt", "currency", "errorMessage", "fxRate", "id", "idempotencyKey", "itineraryId", "payerEmail", "payerId", "paypalCaptureId", "paypalOrderId", "paypalRefundId", "refundedAt", "requestId", "source", "status", "updatedAt" FROM "Payment";
DROP TABLE "Payment";
ALTER TABLE "new_Payment" RENAME TO "Payment";
CREATE UNIQUE INDEX "Payment_paypalOrderId_key" ON "Payment"("paypalOrderId");
CREATE UNIQUE INDEX "Payment_paypalCaptureId_key" ON "Payment"("paypalCaptureId");
CREATE UNIQUE INDEX "Payment_idempotencyKey_key" ON "Payment"("idempotencyKey");
CREATE UNIQUE INDEX "Payment_activeLock_key" ON "Payment"("activeLock");
CREATE INDEX "Payment_status_idx" ON "Payment"("status");
CREATE INDEX "Payment_requestId_idx" ON "Payment"("requestId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;


-- Backfill: give the most recent live (non-seeded) payment per request that is open or may involve
-- money the request's payment slot. Older duplicates (if any) keep a NULL lock but are still
-- blocked by the status checks in the payment service.
UPDATE "Payment" SET "activeLock" = "requestId"
WHERE "source" <> 'SEEDED_HISTORY'
  AND "status" IN ('CREATED', 'PAYER_ACTION_REQUIRED', 'CAPTURING', 'CAPTURE_PENDING', 'CAPTURED', 'REFUNDED')
  AND "id" = (
    SELECT p2."id" FROM "Payment" p2
    WHERE p2."requestId" = "Payment"."requestId"
      AND p2."source" <> 'SEEDED_HISTORY'
      AND p2."status" IN ('CREATED', 'PAYER_ACTION_REQUIRED', 'CAPTURING', 'CAPTURE_PENDING', 'CAPTURED', 'REFUNDED')
    ORDER BY p2."createdAt" DESC LIMIT 1
  );
