-- AlterTable
ALTER TABLE "User" ADD COLUMN     "picture" TEXT,
ALTER COLUMN "password" DROP NOT NULL;
