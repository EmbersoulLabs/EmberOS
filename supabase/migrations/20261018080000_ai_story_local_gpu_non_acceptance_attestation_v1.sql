-- Verified Desktop non-acceptance attestation as one more append-only outcome kind.
-- Additive: existing rows already satisfy both replacement checks.
alter table public.ai_story_local_gpu_submit_outcomes
  drop constraint if exists ai_story_local_gpu_submit_outcomes_kind_check;
alter table public.ai_story_local_gpu_submit_outcomes
  add constraint ai_story_local_gpu_submit_outcomes_kind_check check (kind in (
    'SUBMIT_STARTED',
    'SUBMIT_ACCEPTED',
    'SUBMIT_REJECTED',
    'SUBMIT_UNCERTAIN',
    'STATUS_NOT_FOUND_EXHAUSTED',
    'DESKTOP_NON_ACCEPTANCE_ATTESTED',
    'HUMAN_RETRY_AUTHORIZED'
  ));

alter table public.ai_story_local_gpu_submit_outcomes
  drop constraint if exists ai_story_local_gpu_submit_outcomes_check1;
alter table public.ai_story_local_gpu_submit_outcomes
  add constraint ai_story_local_gpu_submit_outcomes_check1 check (
    (kind in ('HUMAN_RETRY_AUTHORIZED', 'DESKTOP_NON_ACCEPTANCE_ATTESTED')) = (recorded_by = 'HUMAN')
  );

alter table public.ai_story_local_gpu_submit_outcomes
  drop constraint if exists ai_story_local_gpu_submit_outcomes_attestation_evidence_check;
alter table public.ai_story_local_gpu_submit_outcomes
  add constraint ai_story_local_gpu_submit_outcomes_attestation_evidence_check check (
    kind <> 'DESKTOP_NON_ACCEPTANCE_ATTESTED'
    or (diagnostic ? 'attestationDigest' and diagnostic ? 'challenge' and diagnostic->>'verdict' = 'REJECTED_BEFORE_ENQUEUE')
  );
