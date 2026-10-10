-- CreateEnum
CREATE TYPE "ChatAuthorType" AS ENUM ('USER', 'ORGANIZER', 'BOT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ChatCardType" AS ENUM ('FIXTURE', 'TABLE', 'STATS', 'LINK', 'SCORE_SUBMITTED', 'SCORE_CONFIRMED', 'SCORE_CONFLICT');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('PENDING', 'MATCHED', 'CONFLICT', 'APPLIED', 'DISMISSED');

-- AlterTable
ALTER TABLE "Tournament" ADD COLUMN     "arenaBot" JSONB,
ADD COLUMN     "chatEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "chatRules" TEXT,
ADD COLUMN     "requiresScoreEvidence" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "authorType" "ChatAuthorType" NOT NULL,
    "authorUserId" TEXT,
    "participantId" TEXT,
    "text" TEXT NOT NULL,
    "cardType" "ChatCardType",
    "cardPayload" JSONB,
    "pinnedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoreSubmission" (
    "id" TEXT NOT NULL,
    "fixtureId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "homeScore" INTEGER NOT NULL,
    "awayScore" INTEGER NOT NULL,
    "legs" JSONB,
    "evidenceUrl" TEXT,
    "note" TEXT,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'PENDING',
    "resolvedById" TEXT,
    "verdictNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ScoreSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChatMessage_tournamentId_createdAt_idx" ON "ChatMessage"("tournamentId", "createdAt");

-- CreateIndex
CREATE INDEX "ScoreSubmission_fixtureId_status_idx" ON "ScoreSubmission"("fixtureId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ScoreSubmission_fixtureId_participantId_key" ON "ScoreSubmission"("fixtureId", "participantId");

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreSubmission" ADD CONSTRAINT "ScoreSubmission_fixtureId_fkey" FOREIGN KEY ("fixtureId") REFERENCES "Fixture"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreSubmission" ADD CONSTRAINT "ScoreSubmission_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
