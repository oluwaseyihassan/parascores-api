-- AlterTable
ALTER TABLE "Organization" ADD COLUMN "paystackSubaccountCode" TEXT;
ALTER TABLE "Organization" ADD COLUMN "settlementBankCode" TEXT;
ALTER TABLE "Organization" ADD COLUMN "settlementAccountNumber" TEXT;
ALTER TABLE "Organization" ADD COLUMN "settlementAccountName" TEXT;
ALTER TABLE "Organization" ADD COLUMN "payoutAccountCreatedAt" TIMESTAMP(3);
