-- Chat message replies (quoted reply target)
ALTER TABLE "ChatMessage" ADD COLUMN "replyToId" TEXT;

ALTER TABLE "ChatMessage"
  ADD CONSTRAINT "ChatMessage_replyToId_fkey"
  FOREIGN KEY ("replyToId") REFERENCES "ChatMessage"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ChatMessage_replyToId_idx" ON "ChatMessage"("replyToId");
