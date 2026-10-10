-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "instantPayouts" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "paystackRecipientCode" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "payoutAmount" INTEGER,
ADD COLUMN     "payoutInitiatedAt" TIMESTAMP(3),
ADD COLUMN     "payoutStatus" TEXT,
ADD COLUMN     "payoutTransferCode" TEXT;
