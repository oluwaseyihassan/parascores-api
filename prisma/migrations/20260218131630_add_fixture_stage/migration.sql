-- CreateEnum
CREATE TYPE "FixtureStage" AS ENUM ('GROUP_STAGE', 'KNOCKOUT');

-- AlterTable
ALTER TABLE "Fixture" ADD COLUMN     "stage" "FixtureStage";
