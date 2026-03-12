-- AlterTable
ALTER TABLE "Tournament" ADD COLUMN     "thirdPlaceMatch" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "twoLegsKnockout" BOOLEAN NOT NULL DEFAULT false;
