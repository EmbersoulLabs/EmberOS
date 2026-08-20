alter table ai_story_execute_verifications enable row level security;
drop policy if exists ai_story_execute_verifications_select on ai_story_execute_verifications;
create policy ai_story_execute_verifications_select on ai_story_execute_verifications
  for select using (workspace_id in (select user_workspace_ids()));
