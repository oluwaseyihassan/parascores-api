-- CreateEnum
CREATE TYPE "MatchHalf" AS ENUM ('FIRST_HALF', 'SECOND_HALF', 'EXTRA_TIME', 'PENALTY_SHOOTOUT');

-- AlterTable
ALTER TABLE "MatchEvent" ADD COLUMN     "half" "MatchHalf";
