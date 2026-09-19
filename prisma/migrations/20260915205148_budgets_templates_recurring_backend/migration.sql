-- CreateEnum
CREATE TYPE "RecurringRunStatus" AS ENUM ('SUCCEEDED', 'FAILED', 'SKIPPED');

-- AlterTable
ALTER TABLE "Budget" ADD COLUMN "committedAmount" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "RecurringPurchaseRun"
  ADD COLUMN "occurrenceAt" TIMESTAMP(3),
  ADD COLUMN "status" "RecurringRunStatus" NOT NULL DEFAULT 'SUCCEEDED',
  ADD COLUMN "failureReason" TEXT,
  ALTER COLUMN "purchaseRequestId" DROP NOT NULL;

-- Backfill occurrenceAt for any pre-existing rows (none expected - this table was never
-- written to before this migration - ranAt is the closest available value) before enforcing
-- NOT NULL, so the migration is safe even if that assumption is ever wrong.
UPDATE "RecurringPurchaseRun" SET "occurrenceAt" = "ranAt" WHERE "occurrenceAt" IS NULL;
ALTER TABLE "RecurringPurchaseRun" ALTER COLUMN "occurrenceAt" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "RecurringPurchaseRun_recurringId_occurrenceAt_key" ON "RecurringPurchaseRun"("recurringId", "occurrenceAt");

-- CreateTable
CREATE TABLE "BudgetAlertSettings" (
    "companyId" TEXT NOT NULL,
    "thresholds" INTEGER[],

    CONSTRAINT "BudgetAlertSettings_pkey" PRIMARY KEY ("companyId")
);

-- AddForeignKey
ALTER TABLE "BudgetAlertSettings" ADD CONSTRAINT "BudgetAlertSettings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
