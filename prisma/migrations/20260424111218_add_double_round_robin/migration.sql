-- AlterEnum
ALTER TYPE "MatchEventType" ADD VALUE 'MISSED_PENALTY';

-- AlterTable
ALTER TABLE "Tournament" ADD COLUMN     "doubleRoundRobin" BOOLEAN NOT NULL DEFAULT false;
