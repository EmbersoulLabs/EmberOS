CREATE OR REPLACE FUNCTION validate_campaign_creative_handoff_scope() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE p_org uuid; p_workspace uuid; p_campaign uuid; p_iteration uuid; p_status text; p_module text;
BEGIN
  SELECT org_id,workspace_id,campaign_id,iteration_id,status,selected_module
    INTO p_org,p_workspace,p_campaign,p_iteration,p_status,p_module
  FROM campaign_marketing_plan_versions WHERE id=NEW.approved_plan_id;
  IF p_org IS NULL OR p_org<>NEW.org_id OR p_workspace<>NEW.workspace_id OR p_campaign<>NEW.campaign_id
     OR p_iteration<>NEW.iteration_id OR p_status<>'APPROVED' OR p_module<>NEW.selected_module THEN
    RAISE EXCEPTION 'CAMPAIGN_CREATIVE_HANDOFF_SCOPE_MISMATCH';
  END IF;
  RETURN NEW;
END $$;
