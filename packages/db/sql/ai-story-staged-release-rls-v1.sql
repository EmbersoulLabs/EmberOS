alter table ai_story_scene_release_states enable row level security;
drop policy if exists ai_story_scene_release_states_select on ai_story_scene_release_states;
drop policy if exists ai_story_scene_release_states_insert on ai_story_scene_release_states;
drop policy if exists ai_story_scene_release_states_update on ai_story_scene_release_states;
drop policy if exists ai_story_scene_release_states_delete on ai_story_scene_release_states;
create policy ai_story_scene_release_states_select on ai_story_scene_release_states
  for select using (workspace_id in (select user_workspace_ids()));
