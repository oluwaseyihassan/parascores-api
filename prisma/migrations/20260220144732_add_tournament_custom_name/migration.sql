/*
  Warnings:

  - A unique constraint covering the columns `[customName]` on the table `Tournament` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Tournament" ADD COLUMN     "customName" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Tournament_customName_key" ON "Tournament"("customName");
