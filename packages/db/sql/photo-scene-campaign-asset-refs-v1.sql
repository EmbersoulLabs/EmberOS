-- Photo Scene 10A — campaign_asset_refs foundation.
-- Additive campaign binding only. No parallel creative domain tables.
-- Does not alter assets.campaign_id Video Studio cascade semantics.

CREATE TABLE IF NOT EXISTS campaign_asset_refs (
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, asset_id)
);

CREATE INDEX IF NOT EXISTS campaign_asset_refs_campaign_idx
  ON campaign_asset_refs (campaign_id, sort_order);

INSERT INTO campaign_asset_refs (campaign_id, asset_id, sort_order)
SELECT a.campaign_id, a.id, ROW_NUMBER() OVER (PARTITION BY a.campaign_id ORDER BY a.created_at) - 1
FROM assets a
WHERE a.campaign_id IS NOT NULL
ON CONFLICT (campaign_id, asset_id) DO NOTHING;

ALTER TABLE campaign_asset_refs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS campaign_asset_refs_all ON campaign_asset_refs;
CREATE POLICY campaign_asset_refs_all ON campaign_asset_refs
  FOR ALL USING (
    campaign_id IN (SELECT id FROM campaigns WHERE workspace_id IN (SELECT user_workspace_ids()))
  );
