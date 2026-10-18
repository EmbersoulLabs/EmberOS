BEGIN;

-- Forward-only expansion. Historical claims and authorizations retain their
-- original model binding; no rows are rewritten or auto-provisioned.
ALTER TABLE campaign_social_ai_claims
  DROP CONSTRAINT IF EXISTS campaign_social_ai_claims_model_check;
ALTER TABLE campaign_social_ai_claims
  ADD CONSTRAINT campaign_social_ai_claims_model_check
  CHECK (model IN ('gpt-4o-mini', 'gpt-6-luna'));

ALTER TABLE certification_planning_authorities
  DROP CONSTRAINT IF EXISTS certification_planning_model_check;
ALTER TABLE certification_planning_authorities
  ADD CONSTRAINT certification_planning_model_check
  CHECK (model IN ('gpt-4o-mini-2024-07-18', 'gpt-6-luna'));

COMMIT;
