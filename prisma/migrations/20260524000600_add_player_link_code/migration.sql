-- AlterTable
ALTER TABLE "Player" ADD COLUMN     "linkCode" TEXT,
ADD COLUMN     "linkCodeExpires" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Player_linkCode_key" ON "Player"("linkCode");
