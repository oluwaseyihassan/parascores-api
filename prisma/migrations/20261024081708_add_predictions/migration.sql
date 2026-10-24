-- CreateTable
CREATE TABLE "predictions" (
    "id" TEXT NOT NULL,
    "tournament_id" TEXT NOT NULL,
    "fixture_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "home_score" INTEGER NOT NULL,
    "away_score" INTEGER NOT NULL,
    "points" INTEGER,
    "status" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "predictions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "predictions_tournament_id_idx" ON "predictions"("tournament_id");

-- CreateIndex
CREATE INDEX "predictions_fixture_id_idx" ON "predictions"("fixture_id");

-- CreateIndex
CREATE UNIQUE INDEX "predictions_user_id_fixture_id_key" ON "predictions"("user_id", "fixture_id");

-- AddForeignKey
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_fixture_id_fkey" FOREIGN KEY ("fixture_id") REFERENCES "Fixture"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
