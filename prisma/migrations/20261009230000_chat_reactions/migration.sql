-- Chat message reactions
CREATE TABLE "ChatReaction" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatReaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChatReaction_messageId_userId_emoji_key" ON "ChatReaction"("messageId", "userId", "emoji");
CREATE INDEX "ChatReaction_messageId_idx" ON "ChatReaction"("messageId");

ALTER TABLE "ChatReaction"
  ADD CONSTRAINT "ChatReaction_messageId_fkey"
  FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
