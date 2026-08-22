-- CreateTable
CREATE TABLE "ResultEntry" (
    "id" TEXT NOT NULL,
    "fixtureId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "lane" INTEGER,
    "note" TEXT,
    "rank" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResultEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ResultEntry_fixtureId_participantId_key" ON "ResultEntry"("fixtureId", "participantId");

-- AddForeignKey
ALTER TABLE "ResultEntry" ADD CONSTRAINT "ResultEntry_fixtureId_fkey" FOREIGN KEY ("fixtureId") REFERENCES "Fixture"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultEntry" ADD CONSTRAINT "ResultEntry_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
