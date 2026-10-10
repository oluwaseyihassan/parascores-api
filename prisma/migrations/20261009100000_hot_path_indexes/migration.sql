-- Hot-path indexes: chat auth/typing relay + fixture lists/Paragee intents
CREATE INDEX "Participant_tournament_id_user_id_idx" ON "Participant"("tournament_id", "user_id");
CREATE INDEX "Fixture_tournament_id_status_idx" ON "Fixture"("tournament_id", "status");
