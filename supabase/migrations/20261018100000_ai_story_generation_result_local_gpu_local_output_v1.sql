-- Desktop LOCAL_GPU output validated through the shared local output record keeps its origin.
-- Widening only: existing rows already satisfy the replacement check.
alter table public.ai_story_generation_results
  drop constraint if exists ai_story_generation_result_exact_source;
alter table public.ai_story_generation_results
  add constraint ai_story_generation_result_exact_source check (
    (source_kind = 'REMOTE_PROVIDER' and provider_attempt_id is not null and local_generation_output_id is null and local_worker_output_id is null)
    or (source_kind = 'MANUAL_LOCAL' and provider_attempt_id is null and local_generation_output_id is not null and local_worker_output_id is null)
    or (source_kind = 'LOCAL_GPU_WORKER' and provider_attempt_id is null and (local_generation_output_id is null) <> (local_worker_output_id is null))
  );
