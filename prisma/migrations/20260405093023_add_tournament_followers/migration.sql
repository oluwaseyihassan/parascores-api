-- CreateTable
CREATE TABLE "TournamentFollower" (
    "userId" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TournamentFollower_pkey" PRIMARY KEY ("userId","tournamentId")
);

-- AddForeignKey
ALTER TABLE "TournamentFollower" ADD CONSTRAINT "TournamentFollower_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentFollower" ADD CONSTRAINT "TournamentFollower_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;
