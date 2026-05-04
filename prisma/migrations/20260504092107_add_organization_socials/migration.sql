-- AlterTable
ALTER TABLE "Social" ADD COLUMN     "organization_id" TEXT,
ALTER COLUMN "tournament_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Social" ADD CONSTRAINT "Social_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
