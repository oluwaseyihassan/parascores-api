-- AlterTable
ALTER TABLE "Fixture" ADD COLUMN     "timerElapsedSeconds" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "timerIsRunning" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "timerStartedAt" TIMESTAMP(3);
