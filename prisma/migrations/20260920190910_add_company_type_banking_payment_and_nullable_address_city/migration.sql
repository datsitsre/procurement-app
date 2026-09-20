-- CreateEnum
CREATE TYPE "CompanyType" AS ENUM ('LIMITED_LIABILITY', 'SOLE_PROPRIETORSHIP', 'PARTNERSHIP', 'PUBLIC_LIMITED', 'NGO', 'GOVERNMENT', 'OTHER');

-- AlterTable
ALTER TABLE "Address" ALTER COLUMN "city" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "bankAccountName" TEXT,
ADD COLUMN     "bankAccountNumber" TEXT,
ADD COLUMN     "bankName" TEXT,
ADD COLUMN     "companyType" "CompanyType",
ADD COLUMN     "defaultPaymentMethod" "PaymentMethod";
