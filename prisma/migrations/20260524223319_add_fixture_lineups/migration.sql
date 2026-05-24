-- CreateTable
CREATE TABLE "_FixtureLineups" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_FixtureLineups_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_FixtureLineups_B_index" ON "_FixtureLineups"("B");

-- AddForeignKey
ALTER TABLE "_FixtureLineups" ADD CONSTRAINT "_FixtureLineups_A_fkey" FOREIGN KEY ("A") REFERENCES "Fixture"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_FixtureLineups" ADD CONSTRAINT "_FixtureLineups_B_fkey" FOREIGN KEY ("B") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
