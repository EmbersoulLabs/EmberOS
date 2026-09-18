-- Synthetic Production-predecessor preservation evidence. No live IDs or payloads.
BEGIN;
INSERT INTO organizations(id,name,slug) VALUES
('10000000-0000-4000-8000-000000000001','Overlay fixture organization','overlay-fixture-org');
INSERT INTO workspaces(id,org_id,name,slug) VALUES
('10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','Overlay fixture workspace','overlay-fixture-ws');
INSERT INTO campaigns(id,org_id,workspace_id,name) VALUES
('10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','Overlay fixture campaign');
INSERT INTO ai_stories(id,org_id,workspace_id,campaign_id,title,original_idea,status) VALUES
('10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003','Historical synthetic Story','Historical fixture only','generate_review');
INSERT INTO ai_story_versions(id,story_id,version_number,structured_content,frozen_at) VALUES
('10000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000004',1,'{"synthetic":true}'::jsonb,now());
UPDATE ai_stories SET current_version_id='10000000-0000-4000-8000-000000000005' WHERE id='10000000-0000-4000-8000-000000000004';
INSERT INTO ai_story_animation_packages(id,org_id,workspace_id,campaign_id,story_id,story_version_id,payload,status) VALUES
('10000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000005','{"historical":true}'::jsonb,'draft');
INSERT INTO ai_story_scene_instruction_snapshots(content_hash,snapshot_id,org_id,workspace_id,contract_version,instructions) VALUES
('sha256:synthetic-preservation','10000000-0000-4000-8000-000000000007','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','fixture.v1','{"historical":true}'::jsonb);
INSERT INTO ai_story_execution_plans(id,org_id,workspace_id,campaign_id,story_id,story_version_id,animation_package_id,contract_version,compilation_hash,deterministic_fingerprint,plan,compiled_at) VALUES
('10000000-0000-4000-8000-000000000008','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000006','fixture.v1','synthetic-compilation','synthetic-plan','{"historical":true}'::jsonb,now());
INSERT INTO ai_story_scene_executions(id,execution_plan_id,org_id,workspace_id,campaign_id,story_id,story_version_id,animation_package_id,scene_id,scene_order,idempotency_key,deterministic_fingerprint,compilation_hash,instruction_hash,intent) VALUES
('10000000-0000-4000-8000-000000000009','10000000-0000-4000-8000-000000000008','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000006','synthetic-scene',0,'synthetic-scene-key','synthetic-scene-fingerprint','synthetic-compilation','sha256:synthetic-preservation','{"historical":true}'::jsonb);
INSERT INTO ai_story_generated_scene_reviews(generated_scene_review_id,org_id,workspace_id,campaign_id,story_id,execution_plan_id,scene_execution_id,scene_id,provider_attempt_id,decision,contract_version,fact) VALUES
('10000000-0000-4000-8000-000000000010','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000008','10000000-0000-4000-8000-000000000009','synthetic-scene','synthetic-attempt','PENDING_REVIEW','fixture.v1','{"historical":true}'::jsonb);
INSERT INTO provider_executions(execution_id,contract_version,org_id,workspace_id,pipeline_run_id,capability_id,capability_version,idempotency_key,deterministic_fingerprint,request_hash,output_schema_id,output_schema_version,status,execution_metadata) VALUES
('synthetic-execution','fixture.v1','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','synthetic-run','fixture-capability','fixture.v1','synthetic-execution-key','synthetic-fingerprint','synthetic-request-hash','fixture-output','fixture.v1','SUCCEEDED','{"historical":true}'::jsonb);
INSERT INTO provider_attempts(attempt_id,execution_id,contract_version,attempt_number,provider_id,provider_version,model_version,request_hash,status) VALUES
('synthetic-attempt','synthetic-execution','fixture.v1',1,'synthetic-provider','fixture.v1','fixture-model','synthetic-request-hash','SUCCEEDED');
INSERT INTO provider_attempt_usage(attempt_id,usage) VALUES('synthetic-attempt','{"synthetic":true}'::jsonb);
INSERT INTO provider_attempt_costs(attempt_id,cost) VALUES('synthetic-attempt','{"usd":0,"synthetic":true}'::jsonb);
INSERT INTO provider_execution_envelopes(envelope_id,version,payload_reference,org_id,workspace_id,execution_context,capability_id,capability_version,provider_policy_snapshot,canonical_request,request_hash,envelope_hash,created_at) VALUES
('synthetic-envelope','fixture.v1','synthetic-private-payload','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','{"synthetic":true}'::jsonb,'fixture-capability','fixture.v1','{"synthetic":true}'::jsonb,'{"synthetic":true}'::jsonb,'synthetic-request-hash','synthetic-envelope-hash',now());
INSERT INTO provider_outbox_jobs(job_id,contract_version,execution_id,payload_reference,correlation_id,status) VALUES
('synthetic-job','fixture.v1','synthetic-execution','synthetic-private-payload','synthetic-correlation','COMPLETED');
INSERT INTO provider_execution_dispatches(dispatch_id,version,job_id,execution_id,envelope_id,payload_reference,org_id,workspace_id,capability_id,capability_version,request_hash,envelope_hash,dispatch_hash,status,created_at,correlation_id,worker_handoff) VALUES
('synthetic-dispatch','fixture.v1','synthetic-job','synthetic-execution','synthetic-envelope','synthetic-private-payload','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','fixture-capability','fixture.v1','synthetic-request-hash','synthetic-envelope-hash','synthetic-dispatch-hash','DISPATCHED',now(),'synthetic-correlation','{"synthetic":true}'::jsonb);
INSERT INTO provider_execution_finalizations(finalization_id,version,execution_result_id,dispatch_id,execution_id,envelope_id,outbox_job_id,capability_id,workspace_id,correlation_id,provider_id,provider_attempt_id,request_hash,terminal_status,started_at,completed_at,duration_ms,result_hash,accepted_at,integrity_hash) VALUES
('synthetic-finalization','fixture.v1','synthetic-result','synthetic-dispatch','synthetic-execution','synthetic-envelope','synthetic-job','fixture-capability','10000000-0000-4000-8000-000000000002','synthetic-correlation','synthetic-provider','synthetic-attempt','synthetic-request-hash','SUCCEEDED',now(),now(),0,'synthetic-result-hash',now(),'synthetic-integrity-hash');
INSERT INTO provider_finalization_costs(finalization_id,cost,recorded_at) VALUES('synthetic-finalization','{"usd":0,"synthetic":true}'::jsonb,now());
INSERT INTO provider_finalization_usage(finalization_id,usage,recorded_at) VALUES('synthetic-finalization','{"synthetic":true}'::jsonb,now());
INSERT INTO provider_terminal_ledger_records(execution_id,finalization_id,record,integrity_hash,appended_at) VALUES('synthetic-execution','synthetic-finalization','{"synthetic":true}'::jsonb,'synthetic-terminal-integrity',now());
COMMIT;
