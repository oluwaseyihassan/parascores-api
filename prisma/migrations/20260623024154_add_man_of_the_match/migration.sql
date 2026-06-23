-- AlterTable
ALTER TABLE "Fixture" ADD COLUMN     "manOfTheMatchPlayerId" TEXT;

-- AddForeignKey
ALTER TABLE "Fixture" ADD CONSTRAINT "Fixture_manOfTheMatchPlayerId_fkey" FOREIGN KEY ("manOfTheMatchPlayerId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;
