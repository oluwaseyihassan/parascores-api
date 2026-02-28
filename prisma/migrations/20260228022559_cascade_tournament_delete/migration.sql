-- DropForeignKey
ALTER TABLE "Fixture" DROP CONSTRAINT "Fixture_tournament_id_fkey";

-- DropForeignKey
ALTER TABLE "Group" DROP CONSTRAINT "Group_tournament_id_fkey";

-- DropForeignKey
ALTER TABLE "Participant" DROP CONSTRAINT "Participant_tournament_id_fkey";

-- AddForeignKey
ALTER TABLE "Group" ADD CONSTRAINT "Group_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fixture" ADD CONSTRAINT "Fixture_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;
