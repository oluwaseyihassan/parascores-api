-- AlterTable
ALTER TABLE "Tournament" ADD COLUMN     "parent_id" TEXT,
ADD COLUMN     "seasonName" TEXT;

-- AddForeignKey
ALTER TABLE "Tournament" ADD CONSTRAINT "Tournament_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "Tournament"("id") ON DELETE SET NULL ON UPDATE CASCADE;
