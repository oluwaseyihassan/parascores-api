-- AlterTable
ALTER TABLE "Fixture" ADD COLUMN     "venue" TEXT;

-- AlterTable
ALTER TABLE "Tournament" ADD COLUMN     "venues" TEXT[] DEFAULT ARRAY[]::TEXT[];
