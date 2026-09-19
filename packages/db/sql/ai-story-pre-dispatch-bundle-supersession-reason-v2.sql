ALTER TABLE ai_story_pre_dispatch_bundle_supersessions
  DROP CONSTRAINT IF EXISTS ai_story_bundle_supersession_reason_check;

-- The original migration used PostgreSQL's table-qualified generated name.
-- Drop it explicitly so the expanded canonical constraint does not coexist
-- with (and remain blocked by) the legacy two-reason constraint.
ALTER TABLE ai_story_pre_dispatch_bundle_supersessions
  DROP CONSTRAINT IF EXISTS ai_story_pre_dispatch_bundle_supersessions_reason_check;

ALTER TABLE ai_story_pre_dispatch_bundle_supersessions
  ADD CONSTRAINT ai_story_bundle_supersession_reason_check CHECK (reason IN (
    'I2V_PROVIDER_INPUT_PROJECTION_DEFECT',
    'DETERMINISTIC_PRE_DISPATCH_AUTHORITY_DEFECT',
    'REVIEW_RETRY_CREATIVE_INSTRUCTION_PRECEDENCE_DEFECT'
  ));
