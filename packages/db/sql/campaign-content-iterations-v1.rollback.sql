-- Development/rollback authority. Apply only before later workflow phases depend on these tables.
DROP TABLE IF EXISTS campaign_workflow_facts;
DROP TABLE IF EXISTS campaign_content_iterations;
DROP FUNCTION IF EXISTS validate_campaign_workflow_scope();
DROP FUNCTION IF EXISTS campaign_iteration_user_workspace_ids();
