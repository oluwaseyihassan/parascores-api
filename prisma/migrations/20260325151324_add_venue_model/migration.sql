/*
  Warnings:

  - You are about to drop the column `venues` on the `Tournament` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Tournament" DROP COLUMN "venues";

-- CreateTable
CREATE TABLE "Venue" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tournament_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Venue_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Venue" ADD CONSTRAINT "Venue_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;
