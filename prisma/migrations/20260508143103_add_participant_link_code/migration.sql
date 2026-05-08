/*
  Warnings:

  - A unique constraint covering the columns `[linkCode]` on the table `Participant` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Participant" ADD COLUMN     "linkCode" TEXT,
ADD COLUMN     "linkCodeExpires" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Participant_linkCode_key" ON "Participant"("linkCode");
