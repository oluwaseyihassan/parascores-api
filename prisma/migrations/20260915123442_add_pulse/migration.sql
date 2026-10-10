-- CreateTable
CREATE TABLE "PulseItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fixtureId" TEXT,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "sortAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PulseItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PulseReaction" (
    "id" TEXT NOT NULL,
    "pulseItemId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PulseReaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PulseItem_organizationId_sortAt_idx" ON "PulseItem"("organizationId", "sortAt");

-- CreateIndex
CREATE UNIQUE INDEX "PulseItem_type_fixtureId_key" ON "PulseItem"("type", "fixtureId");

-- CreateIndex
CREATE INDEX "PulseReaction_pulseItemId_idx" ON "PulseReaction"("pulseItemId");

-- CreateIndex
CREATE UNIQUE INDEX "PulseReaction_pulseItemId_deviceId_emoji_key" ON "PulseReaction"("pulseItemId", "deviceId", "emoji");

-- AddForeignKey
ALTER TABLE "PulseItem" ADD CONSTRAINT "PulseItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PulseItem" ADD CONSTRAINT "PulseItem_fixtureId_fkey" FOREIGN KEY ("fixtureId") REFERENCES "Fixture"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PulseReaction" ADD CONSTRAINT "PulseReaction_pulseItemId_fkey" FOREIGN KEY ("pulseItemId") REFERENCES "PulseItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
