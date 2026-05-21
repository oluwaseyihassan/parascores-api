-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'SUBSCRIPTION',
ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "Tournament" ADD COLUMN     "isPaidRegistration" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "registrationFee" INTEGER NOT NULL DEFAULT 0;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
