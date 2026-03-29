-- CreateEnum
CREATE TYPE "PlayerStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "Player" ADD COLUMN     "status" "PlayerStatus" NOT NULL DEFAULT 'APPROVED';
