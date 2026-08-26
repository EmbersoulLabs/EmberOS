-- Wave 3: typed Create Campaign context and request idempotency.
-- Additive, backward compatible, and Campaign-ID preserving.
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS objective text,
  ADD COLUMN IF NOT EXISTS objective_custom text,
  ADD COLUMN IF NOT EXISTS target_audience jsonb,
  ADD COLUMN IF NOT EXISTS creation_idempotency_key uuid;

CREATE UNIQUE INDEX IF NOT EXISTS campaigns_workspace_creation_idempotency_idx
  ON campaigns (workspace_id, creation_idempotency_key)
  WHERE creation_idempotency_key IS NOT NULL;
