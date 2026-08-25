ALTER TABLE "agents"
  ADD COLUMN "source_system" TEXT,
  ADD COLUMN "source_agent_key" TEXT,
  ADD COLUMN "source_mls_id" TEXT,
  ADD COLUMN "source_synced_at" TIMESTAMPTZ(3);

CREATE UNIQUE INDEX "agents_source_system_source_agent_key_key"
  ON "agents"("source_system", "source_agent_key");
