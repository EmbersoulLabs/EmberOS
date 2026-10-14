CREATE TABLE IF NOT EXISTS campaign_social_ai_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  iteration_id uuid NOT NULL REFERENCES campaign_content_iterations(id) ON DELETE CASCADE,
  marketing_review_id uuid NOT NULL REFERENCES campaign_marketing_reviews(id) ON DELETE RESTRICT,
  platform text NOT NULL CHECK (platform IN ('YOUTUBE','TIKTOK')),
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL,
  model text NOT NULL CHECK (model='gpt-4o-mini'),
  max_input_tokens integer NOT NULL CHECK (max_input_tokens>0),
  max_output_tokens integer NOT NULL CHECK (max_output_tokens>0),
  reserved_maximum_usd numeric(12,6) NOT NULL CHECK (reserved_maximum_usd>0),
  requested_maximum_usd numeric(12,6) NOT NULL CHECK (requested_maximum_usd>=reserved_maximum_usd),
  status text NOT NULL DEFAULT 'RESERVED' CHECK (status IN ('RESERVED','SUBMITTED','RESULT_READY','SETTLED','CANCELLED','UNKNOWN')),
  provider_request_id text,
  provider_model text,
  input_tokens integer,
  output_tokens integer,
  actual_cost_usd numeric(12,6),
  result_json jsonb,
  draft_id uuid REFERENCES campaign_social_content_drafts(id) ON DELETE RESTRICT,
  error_code text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  completed_at timestamptz,
  CONSTRAINT campaign_social_ai_idempotency_unique UNIQUE(iteration_id,idempotency_key),
  CONSTRAINT campaign_social_ai_settlement_valid CHECK (
    (status='SETTLED' AND provider_request_id IS NOT NULL AND input_tokens IS NOT NULL AND output_tokens IS NOT NULL AND actual_cost_usd IS NOT NULL AND actual_cost_usd<=reserved_maximum_usd AND draft_id IS NOT NULL)
    OR status<>'SETTLED'
  )
);
CREATE INDEX IF NOT EXISTS campaign_social_ai_scope_idx ON campaign_social_ai_claims(workspace_id,campaign_id,iteration_id,platform);
CREATE OR REPLACE FUNCTION validate_campaign_social_ai_scope() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE r campaign_marketing_reviews%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE' AND
    (NEW.org_id,NEW.workspace_id,NEW.campaign_id,NEW.iteration_id,NEW.marketing_review_id,NEW.platform,NEW.idempotency_key,NEW.request_fingerprint,NEW.model,NEW.max_input_tokens,NEW.max_output_tokens,NEW.reserved_maximum_usd,NEW.requested_maximum_usd,NEW.created_by,NEW.created_at)
    IS DISTINCT FROM
    (OLD.org_id,OLD.workspace_id,OLD.campaign_id,OLD.iteration_id,OLD.marketing_review_id,OLD.platform,OLD.idempotency_key,OLD.request_fingerprint,OLD.model,OLD.max_input_tokens,OLD.max_output_tokens,OLD.reserved_maximum_usd,OLD.requested_maximum_usd,OLD.created_by,OLD.created_at)
    THEN RAISE EXCEPTION 'CAMPAIGN_SOCIAL_AI_IMMUTABLE_AUTHORITY'; END IF;
  SELECT * INTO r FROM campaign_marketing_reviews WHERE id=NEW.marketing_review_id;
  IF r.id IS NULL OR r.status<>'APPROVED' OR
    (r.org_id,r.workspace_id,r.campaign_id,r.iteration_id) IS DISTINCT FROM
    (NEW.org_id,NEW.workspace_id,NEW.campaign_id,NEW.iteration_id)
    THEN RAISE EXCEPTION 'CAMPAIGN_SOCIAL_AI_SCOPE_MISMATCH'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS campaign_social_ai_scope_guard ON campaign_social_ai_claims;
CREATE TRIGGER campaign_social_ai_scope_guard BEFORE INSERT OR UPDATE ON campaign_social_ai_claims
FOR EACH ROW EXECUTE FUNCTION validate_campaign_social_ai_scope();
ALTER TABLE campaign_social_ai_claims ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS campaign_social_ai_select ON campaign_social_ai_claims;
CREATE POLICY campaign_social_ai_select ON campaign_social_ai_claims FOR SELECT TO authenticated
USING (workspace_id IN (SELECT campaign_iteration_user_workspace_ids()));
GRANT SELECT ON campaign_social_ai_claims TO authenticated;
REVOKE INSERT,UPDATE,DELETE ON campaign_social_ai_claims FROM authenticated,anon;
