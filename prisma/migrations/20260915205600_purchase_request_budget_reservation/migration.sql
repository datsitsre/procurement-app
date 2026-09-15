-- AlterTable
ALTER TABLE "PurchaseRequest"
  ADD COLUMN "budgetId" TEXT,
  ADD COLUMN "budgetReservedAmount" DECIMAL(14,2);
