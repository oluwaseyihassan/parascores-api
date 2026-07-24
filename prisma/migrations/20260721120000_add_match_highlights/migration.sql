-- CreateEnum
CREATE TYPE "HighlightPlatform" AS ENUM ('YOUTUBE_SHORTS', 'INSTAGRAM_REEL', 'TIKTOK');

-- CreateTable
CREATE TABLE "Highlight" (
    "id" TEXT NOT NULL,
    "fixture_id" TEXT NOT NULL,
    "platform" "HighlightPlatform" NOT NULL,
    "externalUrl" TEXT NOT NULL,
    "embedUrl" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "caption" TEXT,
    "duration" INTEGER,
    "createdById" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Highlight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Highlight_fixture_id_idx" ON "Highlight"("fixture_id");

-- AddForeignKey
ALTER TABLE "Highlight" ADD CONSTRAINT "Highlight_fixture_id_fkey" FOREIGN KEY ("fixture_id") REFERENCES "Fixture"("id") ON DELETE CASCADE ON UPDATE CASCADE;
