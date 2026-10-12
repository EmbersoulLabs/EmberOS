-- Destructive rollback authority. Do not use after Creative Modules depend on approved Plans.
DROP TABLE IF EXISTS campaign_marketing_plan_versions;
DROP FUNCTION IF EXISTS validate_campaign_marketing_plan_scope();
