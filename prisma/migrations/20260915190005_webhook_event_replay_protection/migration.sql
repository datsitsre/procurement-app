-- AlterTable
ALTER TABLE "PaymentTransaction" ADD COLUMN "providerEventId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "PaymentTransaction_provider_providerEventId_key" ON "PaymentTransaction"("provider", "providerEventId");
