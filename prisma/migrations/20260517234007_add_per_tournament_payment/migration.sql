-- AlterEnum
ALTER TYPE "SubscriptionPlan" ADD VALUE 'PER_TOURNAMENT';

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "tournamentId" TEXT;

-- AlterTable
ALTER TABLE "Tournament" ADD COLUMN     "isPremium" BOOLEAN NOT NULL DEFAULT false;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE SET NULL ON UPDATE CASCADE;
