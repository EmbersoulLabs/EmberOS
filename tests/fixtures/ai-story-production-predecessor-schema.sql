-- Read-only pg_catalog-derived Production predecessor, project egkgybrjmzukzmkcrpag.
-- Schema-only, synthetic isolated test database use. Do not apply to Production.
BEGIN;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF; IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF; END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
CREATE TABLE "ai_stories" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "campaign_id" uuid NOT NULL,
  "title" text NOT NULL,
  "original_idea" text NOT NULL,
  "status" text DEFAULT 'draft'::text NOT NULL,
  "current_version_id" uuid,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "archived_at" timestamp with time zone
);
CREATE TABLE "ai_story_animation_packages" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "campaign_id" uuid NOT NULL,
  "story_id" uuid NOT NULL,
  "story_version_id" uuid NOT NULL,
  "status" text DEFAULT 'generating'::text NOT NULL,
  "payload" jsonb NOT NULL,
  "consistency_report" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "approved_at" timestamp with time zone,
  "approved_by" uuid
);
CREATE TABLE "ai_story_assembly_artifacts" (
  "artifact_id" uuid NOT NULL,
  "org_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "campaign_id" uuid NOT NULL,
  "story_id" uuid NOT NULL,
  "story_version_id" uuid NOT NULL,
  "animation_package_id" uuid NOT NULL,
  "execution_plan_id" uuid NOT NULL,
  "assembly_job_id" uuid NOT NULL,
  "execution_identity" text NOT NULL,
  "artifact_reference" text NOT NULL,
  "content_hash" text NOT NULL,
  "media_type" text NOT NULL,
  "duration_ms" integer NOT NULL,
  "width" integer NOT NULL,
  "height" integer NOT NULL,
  "frame_rate" double precision NOT NULL,
  "byte_size" integer NOT NULL,
  "assembly_engine_version" text NOT NULL,
  "normalization_policy_version" text NOT NULL,
  "assembly_runtime_contract_version" text NOT NULL,
  "integrity_hash" text NOT NULL,
  "artifact" jsonb NOT NULL,
  "created_at" timestamp with time zone NOT NULL
);
CREATE TABLE "ai_story_assembly_definitions" (
  "assembly_definition_id" uuid NOT NULL,
  "org_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "campaign_id" uuid NOT NULL,
  "story_id" uuid NOT NULL,
  "story_version_id" uuid NOT NULL,
  "animation_package_id" uuid NOT NULL,
  "execution_plan_id" uuid NOT NULL,
  "scene_count" integer NOT NULL,
  "created_by" uuid NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "contract_version" text NOT NULL,
  "deterministic_fingerprint" text NOT NULL,
  "definition" jsonb NOT NULL,
  "accepted_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "ai_story_assembly_job_facts" (
  "fact_id" uuid NOT NULL,
  "org_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "campaign_id" uuid NOT NULL,
  "story_id" uuid NOT NULL,
  "story_version_id" uuid NOT NULL,
  "animation_package_id" uuid NOT NULL,
  "execution_plan_id" uuid NOT NULL,
  "assembly_job_id" uuid NOT NULL,
  "fact_kind" text NOT NULL,
  "integrity_hash" text NOT NULL,
  "contract_version" text NOT NULL,
  "fact" jsonb NOT NULL,
  "recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "ai_story_assembly_jobs" (
  "assembly_job_id" uuid NOT NULL,
  "org_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "campaign_id" uuid NOT NULL,
  "story_id" uuid NOT NULL,
  "story_version_id" uuid NOT NULL,
  "animation_package_id" uuid NOT NULL,
  "execution_plan_id" uuid NOT NULL,
  "assembly_definition_id" uuid NOT NULL,
  "runtime_authorization_id" uuid NOT NULL,
  "ordered_scene_result_ids" jsonb NOT NULL,
  "ordered_scene_content_hashes" jsonb NOT NULL,
  "assembly_contract_version" text NOT NULL,
  "assembly_engine_snapshot_id" uuid NOT NULL,
  "assembly_engine_snapshot_hash" text NOT NULL,
  "deterministic_fingerprint" text NOT NULL,
  "accepted_at" timestamp with time zone NOT NULL,
  "job" jsonb NOT NULL
);
CREATE TABLE "ai_story_assembly_scene_memberships" (
  "membership_id" uuid NOT NULL,
  "org_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "campaign_id" uuid NOT NULL,
  "story_id" uuid NOT NULL,
  "story_version_id" uuid NOT NULL,
  "animation_package_id" uuid NOT NULL,
  "execution_plan_id" uuid NOT NULL,
  "assembly_definition_id" uuid NOT NULL,
  "scene_execution_id" uuid NOT NULL,
  "scene_id" text NOT NULL,
  "scene_order" integer NOT NULL,
  "contract_version" text NOT NULL,
  "deterministic_fingerprint" text NOT NULL,
  "membership" jsonb NOT NULL,
  "accepted_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "ai_story_asset_links" (
  "story_id" uuid NOT NULL,
  "asset_id" uuid NOT NULL,
  "usage_type" text DEFAULT 'reference'::text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "ai_story_creative_contexts" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "campaign_id" uuid NOT NULL,
  "story_id" uuid NOT NULL,
  "story_version_id" uuid NOT NULL,
  "payload" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "ai_story_durable_scene_media_attestations" (
  "media_attestation_id" uuid NOT NULL,
  "org_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "campaign_id" uuid NOT NULL,
  "story_id" uuid NOT NULL,
  "story_version_id" uuid NOT NULL,
  "animation_package_id" uuid NOT NULL,
  "execution_plan_id" uuid NOT NULL,
  "scene_execution_id" uuid NOT NULL,
  "scene_result_id" uuid NOT NULL,
  "source_media_reference" jsonb NOT NULL,
  "durable_object_reference" text NOT NULL,
  "content_hash" text NOT NULL,
  "byte_size" integer NOT NULL,
  "media_type" text NOT NULL,
  "ingest_contract_version" text NOT NULL,
  "storage_provider" text NOT NULL,
  "storage_namespace_version" text NOT NULL,
  "accepted_at" timestamp with time zone NOT NULL,
  "integrity_hash" text NOT NULL,
  "attestation" jsonb NOT NULL
);
CREATE TABLE "ai_story_execute_verifications" (
  "execution_plan_id" uuid NOT NULL,
  "runtime_authorization_id" uuid NOT NULL,
  "scene_execution_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "outbox_job_id" text NOT NULL,
  "verification_mode" boolean DEFAULT true NOT NULL,
  "verification_policy_version" text NOT NULL,
  "authorized_by" text NOT NULL,
  "created_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "ai_story_execution_jobs" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "campaign_id" uuid NOT NULL,
  "story_id" uuid NOT NULL,
  "animation_package_id" uuid NOT NULL,
  "task_id" uuid,
  "status" text DEFAULT 'queued'::text NOT NULL,
  "capability_id" text DEFAULT 'animation-video-generation'::text NOT NULL,
  "target_output_count" integer DEFAULT 5 NOT NULL,
  "selected_output_count" integer,
  "progress" jsonb DEFAULT '{"phase": "queued", "message": "", "percent": 0, "targetOutputs": 5, "completedOutputs": 0, "providerAttempts": 0}'::jsonb NOT NULL,
  "generate_review" jsonb,
  "execution_manifest" jsonb,
  "provider_execution_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "error_message" text,
  "retry_count" integer DEFAULT 0 NOT NULL,
  "cancel_requested_at" timestamp with time zone,
  "created_by" uuid,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "ai_story_execution_outputs" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "campaign_id" uuid NOT NULL,
  "story_id" uuid NOT NULL,
  "execution_job_id" uuid NOT NULL,
  "animation_package_id" uuid NOT NULL,
  "creative_id" uuid,
  "output_type" text DEFAULT 'animation_video'::text NOT NULL,
  "status" text DEFAULT 'draft'::text NOT NULL,
  "title" text NOT NULL,
  "output_index" integer DEFAULT 0 NOT NULL,
  "storage_path" text,
  "generated_video_asset_id" uuid,
  "referenced_asset_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "execution_manifest" jsonb,
  "caption" text DEFAULT ''::text NOT NULL,
  "hashtags" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "provider_id" text,
  "provider_execution_id" text,
  "quality_score" numeric,
  "failure_message" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "ai_story_execution_plans" (
  "id" uuid NOT NULL,
  "org_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "campaign_id" uuid NOT NULL,
  "story_id" uuid NOT NULL,
  "story_version_id" uuid NOT NULL,
  "animation_package_id" uuid NOT NULL,
  "status" text DEFAULT 'PLANNED'::text NOT NULL,
  "contract_version" text NOT NULL,
  "compilation_hash" text NOT NULL,
  "deterministic_fingerprint" text NOT NULL,
  "plan" jsonb NOT NULL,
  "compiled_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "ai_story_final_story_results" (
  "final_story_result_id" uuid NOT NULL,
  "org_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "campaign_id" uuid NOT NULL,
  "story_id" uuid NOT NULL,
  "story_version_id" uuid NOT NULL,
  "animation_package_id" uuid NOT NULL,
  "execution_plan_id" uuid NOT NULL,
  "assembly_definition_id" uuid NOT NULL,
  "assembly_job_id" uuid NOT NULL,
  "assembly_artifact_id" uuid NOT NULL,
  "assembly_job_identity" text NOT NULL,
  "ordered_scene_result_ids" jsonb NOT NULL,
  "output_media_reference" text NOT NULL,
  "content_hash" text NOT NULL,
  "media_type" text NOT NULL,
  "total_duration_ms" integer NOT NULL,
  "width" integer NOT NULL,
  "height" integer NOT NULL,
  "frame_rate" double precision NOT NULL,
  "assembly_runtime_contract_version" text NOT NULL,
  "assembly_engine_version" text NOT NULL,
  "normalization_policy_version" text NOT NULL,
  "final_story_result_contract_version" text NOT NULL,
  "assembly_engine_snapshot_hash" text NOT NULL,
  "accepted_at" timestamp with time zone NOT NULL,
  "projected_at" timestamp with time zone NOT NULL,
  "projection_version" text NOT NULL,
  "integrity_hash" text NOT NULL,
  "result" jsonb NOT NULL
);
CREATE TABLE "ai_story_generated_scene_reviews" (
  "generated_scene_review_id" uuid NOT NULL,
  "org_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "campaign_id" uuid NOT NULL,
  "story_id" uuid NOT NULL,
  "execution_plan_id" uuid NOT NULL,
  "scene_execution_id" uuid NOT NULL,
  "scene_id" text NOT NULL,
  "provider_attempt_id" text NOT NULL,
  "scene_result_id" uuid,
  "decision" text NOT NULL,
  "decided_by" uuid,
  "decided_at" timestamp with time zone,
  "rationale" text,
  "contract_version" text NOT NULL,
  "fact" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "ai_story_review_opened_facts" (
  "fact_id" uuid NOT NULL,
  "org_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "campaign_id" uuid NOT NULL,
  "story_id" uuid NOT NULL,
  "story_version_id" uuid NOT NULL,
  "animation_package_id" uuid NOT NULL,
  "execution_plan_id" uuid NOT NULL,
  "opened_by" uuid NOT NULL,
  "opened_at" timestamp with time zone NOT NULL,
  "contract_version" text NOT NULL,
  "deterministic_fingerprint" text NOT NULL,
  "fact" jsonb NOT NULL,
  "accepted_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "ai_story_runtime_authorized_facts" (
  "runtime_authorization_id" uuid NOT NULL,
  "org_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "campaign_id" uuid NOT NULL,
  "story_id" uuid NOT NULL,
  "story_version_id" uuid NOT NULL,
  "animation_package_id" uuid NOT NULL,
  "execution_plan_id" uuid NOT NULL,
  "runtime_authorization_version" integer NOT NULL,
  "review_decision_id" uuid NOT NULL,
  "review_hash" text NOT NULL,
  "assembly_definition_id" uuid NOT NULL,
  "assembly_hash" text NOT NULL,
  "ordered_scene_execution_ids" jsonb NOT NULL,
  "qc_result_ids" jsonb NOT NULL,
  "authorized_by" uuid NOT NULL,
  "authorized_at" timestamp with time zone NOT NULL,
  "authorization_contract_version" text NOT NULL,
  "deterministic_integrity_hash" text NOT NULL,
  "fact" jsonb NOT NULL,
  "accepted_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "ai_story_scene_attempt_input_revisions" (
  "retry_input_revision_id" uuid NOT NULL,
  "org_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "campaign_id" uuid NOT NULL,
  "story_id" uuid NOT NULL,
  "execution_plan_id" uuid NOT NULL,
  "scene_execution_id" uuid NOT NULL,
  "revision_number" integer NOT NULL,
  "parent_revision_id" uuid,
  "source_attempt_id" text NOT NULL,
  "source_review_id" uuid NOT NULL,
  "retry_reason" text NOT NULL,
  "creative_direction" jsonb NOT NULL,
  "product_asset_id" uuid NOT NULL,
  "product_authority_hash" text NOT NULL,
  "visual_authority_certification_hash" text NOT NULL,
  "provider_mode_requirement" text NOT NULL,
  "canonical_fingerprint" text NOT NULL,
  "created_by" uuid NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "contract_version" text NOT NULL,
  "fact" jsonb NOT NULL,
  "accepted_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "ai_story_scene_executions" (
  "id" uuid NOT NULL,
  "execution_plan_id" uuid NOT NULL,
  "org_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "campaign_id" uuid NOT NULL,
  "story_id" uuid NOT NULL,
  "story_version_id" uuid NOT NULL,
  "animation_package_id" uuid NOT NULL,
  "scene_id" text NOT NULL,
  "scene_order" integer NOT NULL,
  "status" text DEFAULT 'PLANNED'::text NOT NULL,
  "idempotency_key" text NOT NULL,
  "deterministic_fingerprint" text NOT NULL,
  "compilation_hash" text NOT NULL,
  "instruction_hash" text NOT NULL,
  "intent" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "ai_story_scene_instruction_snapshots" (
  "content_hash" text NOT NULL,
  "snapshot_id" uuid NOT NULL,
  "org_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "contract_version" text NOT NULL,
  "instructions" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "ai_story_scene_intent_review_facts" (
  "fact_id" uuid NOT NULL,
  "org_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "campaign_id" uuid NOT NULL,
  "story_id" uuid NOT NULL,
  "story_version_id" uuid NOT NULL,
  "animation_package_id" uuid NOT NULL,
  "execution_plan_id" uuid NOT NULL,
  "scene_execution_id" uuid NOT NULL,
  "scene_id" text NOT NULL,
  "scene_order" integer NOT NULL,
  "decision" text NOT NULL,
  "reviewed_by" uuid NOT NULL,
  "reviewed_at" timestamp with time zone NOT NULL,
  "instruction_hash" text NOT NULL,
  "qc_result_hash" text NOT NULL,
  "contract_version" text NOT NULL,
  "deterministic_fingerprint" text NOT NULL,
  "fact" jsonb NOT NULL,
  "accepted_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "ai_story_scene_intent_validation_results" (
  "id" uuid NOT NULL,
  "org_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "execution_plan_id" uuid NOT NULL,
  "scene_execution_id" uuid NOT NULL,
  "intent_hash" text NOT NULL,
  "result_hash" text NOT NULL,
  "contract_version" text NOT NULL,
  "status" text NOT NULL,
  "result" jsonb NOT NULL,
  "validated_at" timestamp with time zone NOT NULL,
  "accepted_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "ai_story_scene_projection_correlations" (
  "projection_correlation_id" uuid NOT NULL,
  "org_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "scene_execution_id" uuid NOT NULL,
  "worker_execution_result_id" uuid NOT NULL,
  "provider_execution_id" text NOT NULL,
  "provider_attempt_id" text NOT NULL,
  "outbox_job_id" text NOT NULL,
  "dispatch_id" text NOT NULL,
  "provider_finalization_reference" text NOT NULL,
  "scene_result_id" uuid NOT NULL,
  "integrity_hash" text NOT NULL,
  "contract_version" text NOT NULL,
  "correlation" jsonb NOT NULL,
  "projected_at" timestamp with time zone NOT NULL
);
CREATE TABLE "ai_story_scene_release_states" (
  "scene_execution_id" uuid NOT NULL,
  "execution_plan_id" uuid NOT NULL,
  "runtime_authorization_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "scene_order" integer NOT NULL,
  "release_state" text NOT NULL,
  "release_stage" integer,
  "released_by" uuid,
  "released_at" timestamp with time zone,
  "gate_scene_execution_id" uuid,
  "gate_provider_attempt_id" text,
  "gate_scene_result_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "ai_story_scene_results" (
  "scene_result_id" uuid NOT NULL,
  "org_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "execution_plan_id" uuid NOT NULL,
  "scene_runtime_id" uuid NOT NULL,
  "scene_execution_id" uuid NOT NULL,
  "worker_execution_result_id" uuid NOT NULL,
  "projection_correlation_id" uuid NOT NULL,
  "provider_execution_id" text NOT NULL,
  "provider_attempt_id" text NOT NULL,
  "provider_finalization_reference" text NOT NULL,
  "scene_id" text NOT NULL,
  "scene_order" integer NOT NULL,
  "status" text NOT NULL,
  "integrity_hash" text NOT NULL,
  "contract_version" text NOT NULL,
  "result" jsonb NOT NULL,
  "accepted_at" timestamp with time zone NOT NULL,
  "projected_at" timestamp with time zone NOT NULL
);
CREATE TABLE "ai_story_scene_retry_authorizations" (
  "retry_authorization_id" uuid NOT NULL,
  "org_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "campaign_id" uuid NOT NULL,
  "story_id" uuid NOT NULL,
  "execution_plan_id" uuid NOT NULL,
  "scene_execution_id" uuid NOT NULL,
  "source_review_id" uuid NOT NULL,
  "source_attempt_id" text NOT NULL,
  "authorized_attempt_number" integer NOT NULL,
  "authorized_by" uuid NOT NULL,
  "authorized_at" timestamp with time zone NOT NULL,
  "reason" text NOT NULL,
  "retry_input_revision_id" uuid NOT NULL,
  "retry_input_fingerprint" text NOT NULL,
  "status" text NOT NULL,
  "canonical_fingerprint" text NOT NULL,
  "contract_version" text NOT NULL,
  "fact" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "ai_story_scene_retry_eligibility_facts" (
  "retry_eligibility_id" uuid NOT NULL,
  "org_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "campaign_id" uuid NOT NULL,
  "story_id" uuid NOT NULL,
  "execution_plan_id" uuid NOT NULL,
  "scene_execution_id" uuid NOT NULL,
  "source_review_id" uuid NOT NULL,
  "source_attempt_id" text NOT NULL,
  "eligibility" text NOT NULL,
  "next_attempt_number" integer,
  "reason" text NOT NULL,
  "canonical_fingerprint" text NOT NULL,
  "evaluated_at" timestamp with time zone NOT NULL,
  "contract_version" text NOT NULL,
  "fact" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "ai_story_scene_routing_decisions" (
  "routing_decision_id" uuid NOT NULL,
  "org_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "campaign_id" uuid NOT NULL,
  "story_id" uuid NOT NULL,
  "story_version_id" uuid NOT NULL,
  "animation_package_id" uuid NOT NULL,
  "execution_plan_id" uuid NOT NULL,
  "scene_execution_id" uuid NOT NULL,
  "runtime_authorization_id" uuid NOT NULL,
  "capability_id" text NOT NULL,
  "capability_version" text NOT NULL,
  "selected_provider_id" text NOT NULL,
  "selected_adapter_version" text NOT NULL,
  "registry_snapshot_hash" text NOT NULL,
  "capability_snapshot" jsonb NOT NULL,
  "policy_snapshot" jsonb NOT NULL,
  "candidate_summary" jsonb NOT NULL,
  "decided_at" timestamp with time zone NOT NULL,
  "deterministic_integrity_hash" text NOT NULL,
  "automatic_fallback_enabled" boolean DEFAULT false NOT NULL,
  "contract_version" text NOT NULL,
  "decision" jsonb NOT NULL,
  "accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
  "router_version" integer DEFAULT 1 NOT NULL
);
CREATE TABLE "ai_story_scene_scheduling_correlations" (
  "correlation_id" uuid NOT NULL,
  "org_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "campaign_id" uuid NOT NULL,
  "story_id" uuid NOT NULL,
  "story_version_id" uuid NOT NULL,
  "animation_package_id" uuid NOT NULL,
  "execution_plan_id" uuid NOT NULL,
  "scene_execution_id" uuid NOT NULL,
  "runtime_authorization_id" uuid NOT NULL,
  "routing_decision_id" uuid NOT NULL,
  "provider_execution_id" text NOT NULL,
  "envelope_id" text NOT NULL,
  "outbox_job_id" text NOT NULL,
  "request_hash" text NOT NULL,
  "envelope_hash" text NOT NULL,
  "routing_decision_hash" text NOT NULL,
  "authorization_hash" text NOT NULL,
  "scheduling_identity_hash" text NOT NULL,
  "contract_version" text NOT NULL,
  "scheduled_by" uuid NOT NULL,
  "scheduled_at" timestamp with time zone NOT NULL,
  "correlation" jsonb NOT NULL,
  "accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
  "retry_input_revision_id" uuid
);
CREATE TABLE "ai_story_story_review_facts" (
  "fact_id" uuid NOT NULL,
  "org_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "campaign_id" uuid NOT NULL,
  "story_id" uuid NOT NULL,
  "story_version_id" uuid NOT NULL,
  "animation_package_id" uuid NOT NULL,
  "execution_plan_id" uuid NOT NULL,
  "decision" text NOT NULL,
  "reviewed_by" uuid NOT NULL,
  "reviewed_at" timestamp with time zone NOT NULL,
  "contract_version" text NOT NULL,
  "deterministic_fingerprint" text NOT NULL,
  "fact" jsonb NOT NULL,
  "accepted_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "ai_story_versions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "story_id" uuid NOT NULL,
  "version_number" integer NOT NULL,
  "structured_content" jsonb NOT NULL,
  "source_context_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "ai_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "user_edited" boolean DEFAULT false NOT NULL,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "frozen_at" timestamp with time zone,
  "frozen_by" uuid
);
CREATE TABLE "ai_story_worker_attempt_observations" (
  "observation_id" uuid NOT NULL,
  "org_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "provider_execution_id" text NOT NULL,
  "provider_attempt_id" text NOT NULL,
  "dispatch_id" text NOT NULL,
  "outbox_job_id" text NOT NULL,
  "provider_request_id" text,
  "observation_kind" text NOT NULL,
  "reconciliation_required" boolean DEFAULT false NOT NULL,
  "deterministic_integrity_hash" text NOT NULL,
  "observation" jsonb NOT NULL,
  "produced_at" timestamp with time zone NOT NULL,
  "accepted_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "ai_story_worker_execution_results" (
  "worker_execution_result_id" uuid NOT NULL,
  "org_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "provider_execution_id" text NOT NULL,
  "provider_attempt_id" text NOT NULL,
  "dispatch_id" text NOT NULL,
  "outbox_job_id" text NOT NULL,
  "routing_decision_id" uuid NOT NULL,
  "provider_id" text NOT NULL,
  "adapter_version" text NOT NULL,
  "router_version" integer NOT NULL,
  "provider_request_id" text,
  "worker_state" text NOT NULL,
  "acceptance_classification" text NOT NULL,
  "canonical_provider_state" text NOT NULL,
  "reconciliation_required" boolean DEFAULT false NOT NULL,
  "deterministic_integrity_hash" text NOT NULL,
  "worker_contract_version" text NOT NULL,
  "result" jsonb NOT NULL,
  "produced_at" timestamp with time zone NOT NULL,
  "accepted_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "assets" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "campaign_id" uuid,
  "type" text NOT NULL,
  "storage_path" text NOT NULL,
  "mime_type" text,
  "duration_sec" numeric,
  "width" integer,
  "height" integer,
  "file_size_bytes" bigint,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "display_name" text,
  "original_filename" text,
  "status" text DEFAULT 'ready'::text NOT NULL,
  "source" text DEFAULT 'campaign_upload'::text NOT NULL,
  "uploaded_by" uuid,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  "content_hash" text
);
CREATE TABLE "business_profiles" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "company_name" text,
  "services" text[] DEFAULT '{}'::text[] NOT NULL,
  "business_description" text,
  "target_audience" text,
  "business_email" text,
  "business_phone" text,
  "whatsapp_business" text,
  "website" text,
  "facebook" text,
  "instagram" text,
  "tiktok" text,
  "youtube" text,
  "red_note" text,
  "linkedin" text,
  "country" text,
  "state_province" text,
  "city" text,
  "address" text,
  "postal_code" text,
  "timezone" text,
  "brand_personality" text[] DEFAULT '{}'::text[] NOT NULL,
  "brand_style" text[] DEFAULT '{}'::text[] NOT NULL,
  "brand_values" text[] DEFAULT '{}'::text[] NOT NULL,
  "brand_keywords" text[] DEFAULT '{}'::text[] NOT NULL,
  "logo" text,
  "brand_colors" text[] DEFAULT '{}'::text[] NOT NULL,
  "brand_fonts" text[] DEFAULT '{}'::text[] NOT NULL,
  "brand_images" text[] DEFAULT '{}'::text[] NOT NULL,
  "supported_languages" text[] DEFAULT '{}'::text[] NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" uuid,
  "updated_by" uuid,
  "deleted_at" timestamp with time zone,
  "version" integer DEFAULT 1 NOT NULL,
  "industry_id" text,
  "industry_display_name" text,
  "industry_custom_value" text,
  "business_hours" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "default_publishing_platforms" text[] DEFAULT '{}'::text[] NOT NULL
);
CREATE TABLE "campaigns" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "name" text NOT NULL,
  "goal" text,
  "platforms" text[] DEFAULT '{}'::text[] NOT NULL,
  "status" text DEFAULT 'draft'::text NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "strategy_json" jsonb,
  "objectives" text[] DEFAULT '{}'::text[],
  "industry" text,
  "campaign_brief" text,
  "voice_preset" text DEFAULT 'auto'::text,
  "content_style" text,
  "campaign_goal" text,
  "bgm_preference" text DEFAULT 'auto'::text,
  "company_profile_id" uuid,
  "description" text,
  "target_audience_override" text,
  "campaign_objective_id" text,
  "campaign_objective_custom" text,
  "business_status" text DEFAULT 'draft'::text NOT NULL,
  "output_language" text,
  "subtitle_language" text,
  "cta_language" text,
  "hashtag_language" text,
  "tags" text[] DEFAULT '{}'::text[] NOT NULL,
  "folder" text,
  "is_favorite" boolean DEFAULT false NOT NULL,
  "assigned_to" uuid,
  "first_generated_at" timestamp with time zone,
  "last_generated_at" timestamp with time zone,
  "published_at" timestamp with time zone,
  "archived_at" timestamp with time zone,
  "deleted_at" timestamp with time zone,
  "deleted_by" uuid,
  "purge_after" timestamp with time zone,
  "updated_by" uuid,
  "version" integer DEFAULT 1 NOT NULL,
  "marketing_package_id" uuid,
  "external_asset_url" text,
  "objective" text,
  "objective_custom" text,
  "generate_status" text DEFAULT 'idle'::text NOT NULL,
  "generate_summary" jsonb,
  "target_audience" jsonb,
  "creation_idempotency_key" uuid
);
CREATE TABLE "commercial_execution_authorizations" (
  "commercial_authorization_id" uuid NOT NULL,
  "org_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "capability_key" text NOT NULL,
  "execution_identity" text NOT NULL,
  "entitlement_evidence_id" text NOT NULL,
  "pricing_rule_key" text NOT NULL,
  "pricing_rule_version" text NOT NULL,
  "pricing_rule_integrity_hash" text NOT NULL,
  "credit_reservation_id" uuid,
  "authorized_at" timestamp with time zone NOT NULL,
  "integrity_hash" text NOT NULL,
  "contract_version" text NOT NULL,
  "authorization_body" jsonb NOT NULL
);
CREATE TABLE "creatives" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "campaign_id" uuid NOT NULL,
  "task_id" uuid,
  "status" text DEFAULT 'draft'::text NOT NULL,
  "copy_variants" jsonb DEFAULT '[]'::jsonb,
  "selected_copy_id" text,
  "video_url" text,
  "video_export_url" text,
  "cover_url" text,
  "edit_plan" jsonb,
  "compliance_result" jsonb,
  "platform_adaptations" jsonb DEFAULT '{}'::jsonb,
  "version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "marketing_score_json" jsonb,
  "selected_hook_id" text,
  "publish_status" text DEFAULT 'none'::text,
  "render_status" text DEFAULT 'none'::text,
  "render_progress" jsonb,
  "render_cache_path" text,
  "render_cache_fingerprint" text
);
CREATE TABLE "credit_reservations" (
  "credit_reservation_id" uuid NOT NULL,
  "credit_wallet_id" uuid NOT NULL,
  "org_id" uuid NOT NULL,
  "workspace_id" uuid,
  "amount" integer NOT NULL,
  "currency_unit" text NOT NULL,
  "status" text NOT NULL,
  "pricing_rule_key" text,
  "pricing_rule_version" text,
  "execution_identity" text,
  "created_at" timestamp with time zone NOT NULL,
  "integrity_hash" text NOT NULL,
  "contract_version" text NOT NULL,
  "reservation" jsonb NOT NULL
);
CREATE TABLE "credit_wallets" (
  "credit_wallet_id" uuid NOT NULL,
  "org_id" uuid NOT NULL,
  "available_balance" integer NOT NULL,
  "reserved_balance" integer NOT NULL,
  "currency_unit" text NOT NULL,
  "projected_at" timestamp with time zone NOT NULL,
  "integrity_hash" text NOT NULL,
  "contract_version" text NOT NULL,
  "wallet" jsonb NOT NULL
);
CREATE TABLE "marketing_packages" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "campaign_id" uuid NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "strategy_ref" jsonb,
  "report_ref" jsonb,
  "hook_ref" text,
  "caption_ref" text,
  "cta_ref" text,
  "hashtags_ref" jsonb,
  "subtitle_ref" text,
  "video_ref" text,
  "marketing_score" numeric,
  "user_edited" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "organizations" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "plan" text DEFAULT 'free'::text NOT NULL,
  "settings" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "photo_scene_generations" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "campaign_id" uuid NOT NULL,
  "operation" text DEFAULT 'product_extraction'::text NOT NULL,
  "status" text DEFAULT 'queued'::text NOT NULL,
  "source_asset_id" uuid NOT NULL,
  "source_content_hash" text NOT NULL,
  "input_capsule" jsonb NOT NULL,
  "input_fingerprint" text NOT NULL,
  "output_asset_id" uuid,
  "provider_key" text,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "error_code" text,
  "bounded_error" text,
  "cost_usd" numeric,
  "created_by" uuid,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "provider_attempt_costs" (
  "attempt_id" text NOT NULL,
  "cost" jsonb NOT NULL,
  "recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "provider_attempt_usage" (
  "attempt_id" text NOT NULL,
  "usage" jsonb NOT NULL,
  "recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "provider_attempts" (
  "attempt_id" text NOT NULL,
  "execution_id" text NOT NULL,
  "contract_version" text NOT NULL,
  "attempt_number" integer NOT NULL,
  "provider_id" text NOT NULL,
  "provider_version" text NOT NULL,
  "model_version" text NOT NULL,
  "provider_request_id" text,
  "request_hash" text NOT NULL,
  "response_hash" text,
  "status" text NOT NULL,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "failure" jsonb,
  "warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "provider_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "provider_execution_dispatches" (
  "dispatch_id" text NOT NULL,
  "version" text NOT NULL,
  "job_id" text NOT NULL,
  "execution_id" text NOT NULL,
  "envelope_id" text NOT NULL,
  "payload_reference" text NOT NULL,
  "org_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "capability_id" text NOT NULL,
  "capability_version" text NOT NULL,
  "request_hash" text NOT NULL,
  "envelope_hash" text NOT NULL,
  "dispatch_hash" text NOT NULL,
  "status" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "correlation_id" text NOT NULL,
  "worker_handoff" jsonb NOT NULL
);
CREATE TABLE "provider_execution_envelopes" (
  "envelope_id" text NOT NULL,
  "version" text NOT NULL,
  "payload_reference" text NOT NULL,
  "org_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "execution_context" jsonb NOT NULL,
  "capability_id" text NOT NULL,
  "capability_version" text NOT NULL,
  "provider_policy_snapshot" jsonb NOT NULL,
  "canonical_request" jsonb NOT NULL,
  "request_hash" text NOT NULL,
  "envelope_hash" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL
);
CREATE TABLE "provider_execution_finalizations" (
  "finalization_id" text NOT NULL,
  "version" text NOT NULL,
  "execution_result_id" text NOT NULL,
  "dispatch_id" text NOT NULL,
  "execution_id" text NOT NULL,
  "envelope_id" text NOT NULL,
  "outbox_job_id" text NOT NULL,
  "capability_id" text NOT NULL,
  "workspace_id" uuid NOT NULL,
  "correlation_id" text NOT NULL,
  "provider_id" text NOT NULL,
  "provider_attempt_id" text NOT NULL,
  "provider_request_id" text,
  "request_hash" text NOT NULL,
  "provider_response_hash" text,
  "terminal_status" text NOT NULL,
  "started_at" timestamp with time zone NOT NULL,
  "completed_at" timestamp with time zone NOT NULL,
  "duration_ms" integer NOT NULL,
  "normalized_result_reference" text,
  "failure" jsonb,
  "model" jsonb,
  "result_hash" text NOT NULL,
  "accepted_at" timestamp with time zone NOT NULL,
  "integrity_hash" text NOT NULL
);
CREATE TABLE "provider_executions" (
  "execution_id" text NOT NULL,
  "contract_version" text NOT NULL,
  "org_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "campaign_id" uuid,
  "pipeline_run_id" text NOT NULL,
  "capability_id" text NOT NULL,
  "capability_version" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "deterministic_fingerprint" text NOT NULL,
  "request_hash" text NOT NULL,
  "output_schema_id" text NOT NULL,
  "output_schema_version" text NOT NULL,
  "status" text NOT NULL,
  "execution_metadata" jsonb NOT NULL,
  "accepted_attempt_id" text,
  "accepted_result" jsonb,
  "accepted_response_hash" text,
  "accepted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone
);
CREATE TABLE "provider_finalization_costs" (
  "finalization_id" text NOT NULL,
  "cost" jsonb NOT NULL,
  "recorded_at" timestamp with time zone NOT NULL
);
CREATE TABLE "provider_finalization_usage" (
  "finalization_id" text NOT NULL,
  "usage" jsonb NOT NULL,
  "recorded_at" timestamp with time zone NOT NULL
);
CREATE TABLE "provider_outbox_jobs" (
  "job_id" text NOT NULL,
  "contract_version" text NOT NULL,
  "execution_id" text NOT NULL,
  "payload_reference" text NOT NULL,
  "correlation_id" text NOT NULL,
  "status" text DEFAULT 'PENDING'::text NOT NULL,
  "priority" integer DEFAULT 0 NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "next_visible_at" timestamp with time zone DEFAULT now() NOT NULL,
  "lease_owner" text,
  "lease_expires_at" timestamp with time zone,
  "retry_delay_ms" integer,
  "retry_classification" text,
  "last_error_category" text,
  "dead_letter_reason" text,
  "dead_letter_at" timestamp with time zone,
  "operator_notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  "completion_worker_id" text,
  "completion_metadata" jsonb
);
CREATE TABLE "provider_terminal_ledger_records" (
  "execution_id" text NOT NULL,
  "finalization_id" text NOT NULL,
  "record" jsonb NOT NULL,
  "integrity_hash" text NOT NULL,
  "appended_at" timestamp with time zone NOT NULL
);
CREATE TABLE "tasks" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "campaign_id" uuid NOT NULL,
  "status" text DEFAULT 'queued'::text NOT NULL,
  "ceo_plan" jsonb,
  "current_step" text,
  "step_progress" jsonb DEFAULT '{}'::jsonb,
  "retry_count" integer DEFAULT 0 NOT NULL,
  "cost_usd" numeric DEFAULT '0'::numeric,
  "cost_budget_usd" numeric DEFAULT 0.50,
  "error_message" text,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "strategy_json" jsonb,
  "hooks_json" jsonb,
  "marketing_score_json" jsonb,
  "generation_input_capsule" jsonb,
  "generation_input_fingerprint" text
);
CREATE TABLE "workspace_members" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "user_id" uuid,
  "role" text DEFAULT 'operator'::text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "workspaces" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "brand_profile" jsonb DEFAULT '{}'::jsonb,
  "platform_accounts" jsonb DEFAULT '[]'::jsonb,
  "settings" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "ai_stories" ADD CONSTRAINT "ai_stories_pkey" PRIMARY KEY (id);
ALTER TABLE "ai_story_animation_packages" ADD CONSTRAINT "ai_story_animation_packages_pkey" PRIMARY KEY (id);
ALTER TABLE "ai_story_assembly_artifacts" ADD CONSTRAINT "ai_story_assembly_artifacts_hash_unique" UNIQUE (integrity_hash);
ALTER TABLE "ai_story_assembly_artifacts" ADD CONSTRAINT "ai_story_assembly_artifacts_identity_unique" UNIQUE (execution_identity);
ALTER TABLE "ai_story_assembly_artifacts" ADD CONSTRAINT "ai_story_assembly_artifacts_job_unique" UNIQUE (assembly_job_id);
ALTER TABLE "ai_story_assembly_artifacts" ADD CONSTRAINT "ai_story_assembly_artifacts_pkey" PRIMARY KEY (artifact_id);
ALTER TABLE "ai_story_assembly_definitions" ADD CONSTRAINT "ai_story_assembly_definition_fingerprint_unique" UNIQUE (deterministic_fingerprint);
ALTER TABLE "ai_story_assembly_definitions" ADD CONSTRAINT "ai_story_assembly_definition_plan_unique" UNIQUE (execution_plan_id);
ALTER TABLE "ai_story_assembly_definitions" ADD CONSTRAINT "ai_story_assembly_definitions_pkey" PRIMARY KEY (assembly_definition_id);
ALTER TABLE "ai_story_assembly_definitions" ADD CONSTRAINT "ai_story_assembly_definitions_scene_count_check" CHECK (scene_count > 0);
ALTER TABLE "ai_story_assembly_job_facts" ADD CONSTRAINT "ai_story_assembly_job_facts_fact_kind_check" CHECK (fact_kind = ANY (ARRAY['ACCEPTED'::text, 'PROCESSING_STARTED'::text, 'SUCCEEDED'::text, 'FAILED'::text]));
ALTER TABLE "ai_story_assembly_job_facts" ADD CONSTRAINT "ai_story_assembly_job_facts_hash_unique" UNIQUE (integrity_hash);
ALTER TABLE "ai_story_assembly_job_facts" ADD CONSTRAINT "ai_story_assembly_job_facts_pkey" PRIMARY KEY (fact_id);
ALTER TABLE "ai_story_assembly_jobs" ADD CONSTRAINT "ai_story_assembly_jobs_fingerprint_unique" UNIQUE (deterministic_fingerprint);
ALTER TABLE "ai_story_assembly_jobs" ADD CONSTRAINT "ai_story_assembly_jobs_pkey" PRIMARY KEY (assembly_job_id);
ALTER TABLE "ai_story_assembly_scene_memberships" ADD CONSTRAINT "ai_story_assembly_membership_def_order_unique" UNIQUE (assembly_definition_id, scene_order);
ALTER TABLE "ai_story_assembly_scene_memberships" ADD CONSTRAINT "ai_story_assembly_membership_def_scene_unique" UNIQUE (assembly_definition_id, scene_execution_id);
ALTER TABLE "ai_story_assembly_scene_memberships" ADD CONSTRAINT "ai_story_assembly_membership_fingerprint_unique" UNIQUE (deterministic_fingerprint);
ALTER TABLE "ai_story_assembly_scene_memberships" ADD CONSTRAINT "ai_story_assembly_scene_memberships_pkey" PRIMARY KEY (membership_id);
ALTER TABLE "ai_story_assembly_scene_memberships" ADD CONSTRAINT "ai_story_assembly_scene_memberships_scene_order_check" CHECK (scene_order >= 0);
ALTER TABLE "ai_story_asset_links" ADD CONSTRAINT "ai_story_asset_links_pkey" PRIMARY KEY (story_id, asset_id);
ALTER TABLE "ai_story_creative_contexts" ADD CONSTRAINT "ai_story_creative_contexts_pkey" PRIMARY KEY (id);
ALTER TABLE "ai_story_durable_scene_media_attestations" ADD CONSTRAINT "ai_story_durable_scene_media_attestations_byte_size_check" CHECK (byte_size > 0);
ALTER TABLE "ai_story_durable_scene_media_attestations" ADD CONSTRAINT "ai_story_durable_scene_media_attestations_pkey" PRIMARY KEY (media_attestation_id);
ALTER TABLE "ai_story_durable_scene_media_attestations" ADD CONSTRAINT "ai_story_durable_scene_media_integrity_unique" UNIQUE (integrity_hash);
ALTER TABLE "ai_story_durable_scene_media_attestations" ADD CONSTRAINT "ai_story_durable_scene_media_object_unique" UNIQUE (durable_object_reference);
ALTER TABLE "ai_story_durable_scene_media_attestations" ADD CONSTRAINT "ai_story_durable_scene_media_scene_unique" UNIQUE (scene_result_id);
ALTER TABLE "ai_story_execute_verifications" ADD CONSTRAINT "ai_story_execute_verifications_authorized_by_check" CHECK (authorized_by = 'ACTIVE_PLATFORM_ADMIN'::text);
ALTER TABLE "ai_story_execute_verifications" ADD CONSTRAINT "ai_story_execute_verifications_outbox_job_id_key" UNIQUE (outbox_job_id);
ALTER TABLE "ai_story_execute_verifications" ADD CONSTRAINT "ai_story_execute_verifications_pkey" PRIMARY KEY (execution_plan_id);
ALTER TABLE "ai_story_execute_verifications" ADD CONSTRAINT "ai_story_execute_verifications_runtime_authorization_id_key" UNIQUE (runtime_authorization_id);
ALTER TABLE "ai_story_execute_verifications" ADD CONSTRAINT "ai_story_execute_verifications_verification_mode_check" CHECK (verification_mode = true);
ALTER TABLE "ai_story_execution_jobs" ADD CONSTRAINT "ai_story_execution_jobs_pkey" PRIMARY KEY (id);
ALTER TABLE "ai_story_execution_outputs" ADD CONSTRAINT "ai_story_execution_outputs_execution_job_id_output_index_key" UNIQUE (execution_job_id, output_index);
ALTER TABLE "ai_story_execution_outputs" ADD CONSTRAINT "ai_story_execution_outputs_pkey" PRIMARY KEY (id);
ALTER TABLE "ai_story_execution_plans" ADD CONSTRAINT "ai_story_execution_plans_fingerprint_unique" UNIQUE (deterministic_fingerprint);
ALTER TABLE "ai_story_execution_plans" ADD CONSTRAINT "ai_story_execution_plans_pkey" PRIMARY KEY (id);
ALTER TABLE "ai_story_execution_plans" ADD CONSTRAINT "ai_story_execution_plans_status_check" CHECK (status = 'PLANNED'::text);
ALTER TABLE "ai_story_final_story_results" ADD CONSTRAINT "ai_story_final_story_results_artifact_unique" UNIQUE (assembly_artifact_id);
ALTER TABLE "ai_story_final_story_results" ADD CONSTRAINT "ai_story_final_story_results_integrity_unique" UNIQUE (integrity_hash);
ALTER TABLE "ai_story_final_story_results" ADD CONSTRAINT "ai_story_final_story_results_job_identity_unique" UNIQUE (assembly_job_identity);
ALTER TABLE "ai_story_final_story_results" ADD CONSTRAINT "ai_story_final_story_results_job_unique" UNIQUE (assembly_job_id);
ALTER TABLE "ai_story_final_story_results" ADD CONSTRAINT "ai_story_final_story_results_pkey" PRIMARY KEY (final_story_result_id);
ALTER TABLE "ai_story_generated_scene_reviews" ADD CONSTRAINT "ai_story_generated_scene_reviews_decision_check" CHECK (decision = ANY (ARRAY['PENDING_REVIEW'::text, 'APPROVED'::text, 'REJECTED'::text, 'RETRY_REQUESTED'::text, 'REJECTED_TERMINAL'::text]));
ALTER TABLE "ai_story_generated_scene_reviews" ADD CONSTRAINT "ai_story_generated_scene_reviews_pkey" PRIMARY KEY (generated_scene_review_id);
ALTER TABLE "ai_story_generated_scene_reviews" ADD CONSTRAINT "ai_story_generated_scene_reviews_scene_attempt_unique" UNIQUE (scene_execution_id, provider_attempt_id);
ALTER TABLE "ai_story_review_opened_facts" ADD CONSTRAINT "ai_story_review_opened_facts_pkey" PRIMARY KEY (fact_id);
ALTER TABLE "ai_story_review_opened_facts" ADD CONSTRAINT "ai_story_review_opened_fingerprint_unique" UNIQUE (deterministic_fingerprint);
ALTER TABLE "ai_story_review_opened_facts" ADD CONSTRAINT "ai_story_review_opened_plan_unique" UNIQUE (execution_plan_id);
ALTER TABLE "ai_story_runtime_authorized_facts" ADD CONSTRAINT "ai_story_runtime_auth_hash_unique" UNIQUE (deterministic_integrity_hash);
ALTER TABLE "ai_story_runtime_authorized_facts" ADD CONSTRAINT "ai_story_runtime_auth_plan_unique" UNIQUE (execution_plan_id);
ALTER TABLE "ai_story_runtime_authorized_facts" ADD CONSTRAINT "ai_story_runtime_authorized__runtime_authorization_versio_check" CHECK (runtime_authorization_version >= 1);
ALTER TABLE "ai_story_runtime_authorized_facts" ADD CONSTRAINT "ai_story_runtime_authorized_facts_pkey" PRIMARY KEY (runtime_authorization_id);
ALTER TABLE "ai_story_scene_attempt_input_revisions" ADD CONSTRAINT "ai_story_scene_attempt_input_re_provider_mode_requirement_check" CHECK (provider_mode_requirement = 'FIRST_FRAME_I2V'::text);
ALTER TABLE "ai_story_scene_attempt_input_revisions" ADD CONSTRAINT "ai_story_scene_attempt_input_revision_hash_unique" UNIQUE (canonical_fingerprint);
ALTER TABLE "ai_story_scene_attempt_input_revisions" ADD CONSTRAINT "ai_story_scene_attempt_input_revision_number_unique" UNIQUE (scene_execution_id, revision_number);
ALTER TABLE "ai_story_scene_attempt_input_revisions" ADD CONSTRAINT "ai_story_scene_attempt_input_revisions_pkey" PRIMARY KEY (retry_input_revision_id);
ALTER TABLE "ai_story_scene_attempt_input_revisions" ADD CONSTRAINT "ai_story_scene_attempt_input_revisions_retry_reason_check" CHECK (retry_reason = ANY (ARRAY['INSUFFICIENT_SCENE_DIFFERENTIATION'::text, 'PRODUCT_IDENTITY_DRIFT'::text, 'COMPOSITION_UNACCEPTABLE'::text, 'CAMERA_MOTION_UNACCEPTABLE'::text, 'VISUAL_QUALITY_UNACCEPTABLE'::text, 'CONTINUITY_UNACCEPTABLE'::text, 'OTHER_CREATIVE_REASON'::text]));
ALTER TABLE "ai_story_scene_attempt_input_revisions" ADD CONSTRAINT "ai_story_scene_attempt_input_revisions_revision_number_check" CHECK (revision_number >= 1 AND revision_number <= 3);
ALTER TABLE "ai_story_scene_attempt_input_revisions" ADD CONSTRAINT "ai_story_scene_retry_revision_mode_v1" CHECK (provider_mode_requirement = 'FIRST_FRAME_I2V'::text);
ALTER TABLE "ai_story_scene_attempt_input_revisions" ADD CONSTRAINT "ai_story_scene_retry_revision_number_v1" CHECK (revision_number >= 1 AND revision_number <= 3);
ALTER TABLE "ai_story_scene_executions" ADD CONSTRAINT "ai_story_scene_executions_idempotency_key_key" UNIQUE (idempotency_key);
ALTER TABLE "ai_story_scene_executions" ADD CONSTRAINT "ai_story_scene_executions_pkey" PRIMARY KEY (id);
ALTER TABLE "ai_story_scene_executions" ADD CONSTRAINT "ai_story_scene_executions_plan_order_unique" UNIQUE (execution_plan_id, scene_order);
ALTER TABLE "ai_story_scene_executions" ADD CONSTRAINT "ai_story_scene_executions_plan_scene_unique" UNIQUE (execution_plan_id, scene_id);
ALTER TABLE "ai_story_scene_executions" ADD CONSTRAINT "ai_story_scene_executions_scene_order_check" CHECK (scene_order >= 0);
ALTER TABLE "ai_story_scene_executions" ADD CONSTRAINT "ai_story_scene_executions_status_check" CHECK (status = 'PLANNED'::text);
ALTER TABLE "ai_story_scene_instruction_snapshots" ADD CONSTRAINT "ai_story_scene_instruction_snapshots_pkey" PRIMARY KEY (content_hash);
ALTER TABLE "ai_story_scene_instruction_snapshots" ADD CONSTRAINT "ai_story_scene_instruction_snapshots_snapshot_id_key" UNIQUE (snapshot_id);
ALTER TABLE "ai_story_scene_intent_review_facts" ADD CONSTRAINT "ai_story_scene_intent_review_facts_decision_check" CHECK (decision = ANY (ARRAY['APPROVED'::text, 'REJECTED'::text]));
ALTER TABLE "ai_story_scene_intent_review_facts" ADD CONSTRAINT "ai_story_scene_intent_review_facts_pkey" PRIMARY KEY (fact_id);
ALTER TABLE "ai_story_scene_intent_review_facts" ADD CONSTRAINT "ai_story_scene_intent_review_facts_scene_order_check" CHECK (scene_order >= 0);
ALTER TABLE "ai_story_scene_intent_review_facts" ADD CONSTRAINT "ai_story_scene_intent_review_fingerprint_unique" UNIQUE (deterministic_fingerprint);
ALTER TABLE "ai_story_scene_intent_validation_results" ADD CONSTRAINT "ai_story_scene_intent_validation_results_pkey" PRIMARY KEY (id);
ALTER TABLE "ai_story_scene_intent_validation_results" ADD CONSTRAINT "ai_story_scene_intent_validation_results_status_check" CHECK (status = ANY (ARRAY['passed'::text, 'failed'::text, 'warning'::text]));
ALTER TABLE "ai_story_scene_intent_validation_results" ADD CONSTRAINT "ai_story_scene_validation_result_unique" UNIQUE (scene_execution_id, result_hash);
ALTER TABLE "ai_story_scene_projection_correlations" ADD CONSTRAINT "ai_story_scene_projection_correlations_pkey" PRIMARY KEY (projection_correlation_id);
ALTER TABLE "ai_story_scene_projection_correlations" ADD CONSTRAINT "ai_story_scene_projection_finalization_unique" UNIQUE (provider_finalization_reference);
ALTER TABLE "ai_story_scene_projection_correlations" ADD CONSTRAINT "ai_story_scene_projection_hash_unique" UNIQUE (integrity_hash);
ALTER TABLE "ai_story_scene_release_states" ADD CONSTRAINT "ai_story_scene_release_plan_order_unique" UNIQUE (execution_plan_id, scene_order);
ALTER TABLE "ai_story_scene_release_states" ADD CONSTRAINT "ai_story_scene_release_states_pkey" PRIMARY KEY (scene_execution_id);
ALTER TABLE "ai_story_scene_release_states" ADD CONSTRAINT "ai_story_scene_release_states_release_state_check" CHECK (release_state = ANY (ARRAY['AUTHORIZED_NOT_RELEASED'::text, 'RELEASED'::text]));
ALTER TABLE "ai_story_scene_results" ADD CONSTRAINT "ai_story_scene_results_hash_unique" UNIQUE (integrity_hash);
ALTER TABLE "ai_story_scene_results" ADD CONSTRAINT "ai_story_scene_results_pkey" PRIMARY KEY (scene_result_id);
ALTER TABLE "ai_story_scene_results" ADD CONSTRAINT "ai_story_scene_results_worker_unique" UNIQUE (worker_execution_result_id);
ALTER TABLE "ai_story_scene_retry_authorizations" ADD CONSTRAINT "ai_story_scene_retry_authorizat_authorized_attempt_number_check" CHECK (authorized_attempt_number >= 2 AND authorized_attempt_number <= 3);
ALTER TABLE "ai_story_scene_retry_authorizations" ADD CONSTRAINT "ai_story_scene_retry_authorization_attempt_unique" UNIQUE (scene_execution_id, authorized_attempt_number);
ALTER TABLE "ai_story_scene_retry_authorizations" ADD CONSTRAINT "ai_story_scene_retry_authorization_attempt_v1" CHECK (authorized_attempt_number >= 2 AND authorized_attempt_number <= 3);
ALTER TABLE "ai_story_scene_retry_authorizations" ADD CONSTRAINT "ai_story_scene_retry_authorization_hash_unique" UNIQUE (canonical_fingerprint);
ALTER TABLE "ai_story_scene_retry_authorizations" ADD CONSTRAINT "ai_story_scene_retry_authorization_revision_unique" UNIQUE (retry_input_revision_id);
ALTER TABLE "ai_story_scene_retry_authorizations" ADD CONSTRAINT "ai_story_scene_retry_authorization_status_v1" CHECK (status = ANY (ARRAY['AUTHORIZED'::text, 'CONSUMED'::text]));
ALTER TABLE "ai_story_scene_retry_authorizations" ADD CONSTRAINT "ai_story_scene_retry_authorizations_pkey" PRIMARY KEY (retry_authorization_id);
ALTER TABLE "ai_story_scene_retry_authorizations" ADD CONSTRAINT "ai_story_scene_retry_authorizations_reason_check" CHECK (reason = ANY (ARRAY['INSUFFICIENT_SCENE_DIFFERENTIATION'::text, 'PRODUCT_IDENTITY_DRIFT'::text, 'COMPOSITION_UNACCEPTABLE'::text, 'CAMERA_MOTION_UNACCEPTABLE'::text, 'VISUAL_QUALITY_UNACCEPTABLE'::text, 'CONTINUITY_UNACCEPTABLE'::text, 'OTHER_CREATIVE_REASON'::text]));
ALTER TABLE "ai_story_scene_retry_authorizations" ADD CONSTRAINT "ai_story_scene_retry_authorizations_status_check" CHECK (status = ANY (ARRAY['AUTHORIZED'::text, 'CONSUMED'::text]));
ALTER TABLE "ai_story_scene_retry_eligibility_facts" ADD CONSTRAINT "ai_story_scene_retry_eligibility_attempt_v1" CHECK (eligibility = 'ELIGIBLE'::text AND next_attempt_number >= 2 AND next_attempt_number <= 3 OR eligibility <> 'ELIGIBLE'::text AND next_attempt_number IS NULL);
ALTER TABLE "ai_story_scene_retry_eligibility_facts" ADD CONSTRAINT "ai_story_scene_retry_eligibility_facts_eligibility_check" CHECK (eligibility = ANY (ARRAY['ELIGIBLE'::text, 'INELIGIBLE_MAX_ATTEMPTS'::text, 'INELIGIBLE_TERMINAL_POLICY'::text, 'INELIGIBLE_AUTHORITY_CONFLICT'::text]));
ALTER TABLE "ai_story_scene_retry_eligibility_facts" ADD CONSTRAINT "ai_story_scene_retry_eligibility_facts_pkey" PRIMARY KEY (retry_eligibility_id);
ALTER TABLE "ai_story_scene_retry_eligibility_facts" ADD CONSTRAINT "ai_story_scene_retry_eligibility_facts_reason_check" CHECK (reason = ANY (ARRAY['INSUFFICIENT_SCENE_DIFFERENTIATION'::text, 'PRODUCT_IDENTITY_DRIFT'::text, 'COMPOSITION_UNACCEPTABLE'::text, 'CAMERA_MOTION_UNACCEPTABLE'::text, 'VISUAL_QUALITY_UNACCEPTABLE'::text, 'CONTINUITY_UNACCEPTABLE'::text, 'OTHER_CREATIVE_REASON'::text]));
ALTER TABLE "ai_story_scene_retry_eligibility_facts" ADD CONSTRAINT "ai_story_scene_retry_eligibility_hash_unique" UNIQUE (canonical_fingerprint);
ALTER TABLE "ai_story_scene_retry_eligibility_facts" ADD CONSTRAINT "ai_story_scene_retry_eligibility_review_unique" UNIQUE (source_review_id);
ALTER TABLE "ai_story_scene_retry_eligibility_facts" ADD CONSTRAINT "ai_story_scene_retry_eligibility_value_v1" CHECK (eligibility = ANY (ARRAY['ELIGIBLE'::text, 'INELIGIBLE_MAX_ATTEMPTS'::text, 'INELIGIBLE_TERMINAL_POLICY'::text, 'INELIGIBLE_AUTHORITY_CONFLICT'::text]));
ALTER TABLE "ai_story_scene_routing_decisions" ADD CONSTRAINT "ai_story_scene_routing_decisio_automatic_fallback_enabled_check" CHECK (automatic_fallback_enabled = false);
ALTER TABLE "ai_story_scene_routing_decisions" ADD CONSTRAINT "ai_story_scene_routing_decisions_pkey" PRIMARY KEY (routing_decision_id);
ALTER TABLE "ai_story_scene_routing_decisions" ADD CONSTRAINT "ai_story_scene_routing_hash_unique" UNIQUE (deterministic_integrity_hash);
ALTER TABLE "ai_story_scene_routing_decisions" ADD CONSTRAINT "ai_story_scene_routing_router_version_check" CHECK (router_version = 1);
ALTER TABLE "ai_story_scene_routing_decisions" ADD CONSTRAINT "ai_story_scene_routing_scene_unique" UNIQUE (scene_execution_id);
ALTER TABLE "ai_story_scene_scheduling_correlations" ADD CONSTRAINT "ai_story_scene_scheduling_correlations_pkey" PRIMARY KEY (correlation_id);
ALTER TABLE "ai_story_scene_scheduling_correlations" ADD CONSTRAINT "ai_story_scene_scheduling_identity_unique" UNIQUE (scheduling_identity_hash);
ALTER TABLE "ai_story_scene_scheduling_correlations" ADD CONSTRAINT "ai_story_scene_scheduling_outbox_unique" UNIQUE (outbox_job_id);
ALTER TABLE "ai_story_scene_scheduling_correlations" ADD CONSTRAINT "ai_story_scene_scheduling_provider_unique" UNIQUE (provider_execution_id);
ALTER TABLE "ai_story_story_review_facts" ADD CONSTRAINT "ai_story_story_review_facts_decision_check" CHECK (decision = ANY (ARRAY['APPROVED'::text, 'REJECTED'::text]));
ALTER TABLE "ai_story_story_review_facts" ADD CONSTRAINT "ai_story_story_review_facts_pkey" PRIMARY KEY (fact_id);
ALTER TABLE "ai_story_story_review_facts" ADD CONSTRAINT "ai_story_story_review_fingerprint_unique" UNIQUE (deterministic_fingerprint);
ALTER TABLE "ai_story_versions" ADD CONSTRAINT "ai_story_versions_pkey" PRIMARY KEY (id);
ALTER TABLE "ai_story_versions" ADD CONSTRAINT "ai_story_versions_story_id_version_number_key" UNIQUE (story_id, version_number);
ALTER TABLE "ai_story_worker_attempt_observations" ADD CONSTRAINT "ai_story_worker_attempt_observations_pkey" PRIMARY KEY (observation_id);
ALTER TABLE "ai_story_worker_attempt_observations" ADD CONSTRAINT "ai_story_worker_observation_hash_unique" UNIQUE (deterministic_integrity_hash);
ALTER TABLE "ai_story_worker_execution_results" ADD CONSTRAINT "ai_story_worker_execution_results_pkey" PRIMARY KEY (worker_execution_result_id);
ALTER TABLE "ai_story_worker_execution_results" ADD CONSTRAINT "ai_story_worker_execution_results_router_version_check" CHECK (router_version = 1);
ALTER TABLE "ai_story_worker_execution_results" ADD CONSTRAINT "ai_story_worker_result_attempt_unique" UNIQUE (provider_attempt_id);
ALTER TABLE "ai_story_worker_execution_results" ADD CONSTRAINT "ai_story_worker_result_dispatch_unique" UNIQUE (dispatch_id);
ALTER TABLE "ai_story_worker_execution_results" ADD CONSTRAINT "ai_story_worker_result_hash_unique" UNIQUE (deterministic_integrity_hash);
ALTER TABLE "assets" ADD CONSTRAINT "assets_content_hash_format_check" CHECK (content_hash IS NULL OR content_hash ~ '^sha256:[a-f0-9]{64}$'::text);
ALTER TABLE "assets" ADD CONSTRAINT "assets_pkey" PRIMARY KEY (id);
ALTER TABLE "business_profiles" ADD CONSTRAINT "business_profiles_pkey" PRIMARY KEY (id);
ALTER TABLE "business_profiles" ADD CONSTRAINT "business_profiles_workspace_id_key" UNIQUE (workspace_id);
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_pkey" PRIMARY KEY (id);
ALTER TABLE "commercial_execution_authorizations" ADD CONSTRAINT "commercial_execution_authorizations_execution_unique" UNIQUE (org_id, workspace_id, capability_key, execution_identity);
ALTER TABLE "commercial_execution_authorizations" ADD CONSTRAINT "commercial_execution_authorizations_integrity_unique" UNIQUE (integrity_hash);
ALTER TABLE "commercial_execution_authorizations" ADD CONSTRAINT "commercial_execution_authorizations_pkey" PRIMARY KEY (commercial_authorization_id);
ALTER TABLE "creatives" ADD CONSTRAINT "creatives_pkey" PRIMARY KEY (id);
ALTER TABLE "credit_reservations" ADD CONSTRAINT "credit_reservations_amount_check" CHECK (amount > 0);
ALTER TABLE "credit_reservations" ADD CONSTRAINT "credit_reservations_currency_unit_check" CHECK (currency_unit = 'credit'::text);
ALTER TABLE "credit_reservations" ADD CONSTRAINT "credit_reservations_integrity_unique" UNIQUE (integrity_hash);
ALTER TABLE "credit_reservations" ADD CONSTRAINT "credit_reservations_pkey" PRIMARY KEY (credit_reservation_id);
ALTER TABLE "credit_reservations" ADD CONSTRAINT "credit_reservations_status_check" CHECK (status = ANY (ARRAY['PENDING'::text, 'ACCEPTED'::text, 'SETTLED'::text, 'RELEASED'::text]));
ALTER TABLE "credit_wallets" ADD CONSTRAINT "credit_wallets_currency_unit_check" CHECK (currency_unit = 'credit'::text);
ALTER TABLE "credit_wallets" ADD CONSTRAINT "credit_wallets_integrity_unique" UNIQUE (integrity_hash);
ALTER TABLE "credit_wallets" ADD CONSTRAINT "credit_wallets_org_unique" UNIQUE (org_id);
ALTER TABLE "credit_wallets" ADD CONSTRAINT "credit_wallets_pkey" PRIMARY KEY (credit_wallet_id);
ALTER TABLE "credit_wallets" ADD CONSTRAINT "credit_wallets_reserved_balance_check" CHECK (reserved_balance >= 0);
ALTER TABLE "marketing_packages" ADD CONSTRAINT "marketing_packages_campaign_id_key" UNIQUE (campaign_id);
ALTER TABLE "marketing_packages" ADD CONSTRAINT "marketing_packages_pkey" PRIMARY KEY (id);
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_pkey" PRIMARY KEY (id);
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_slug_unique" UNIQUE (slug);
ALTER TABLE "photo_scene_generations" ADD CONSTRAINT "photo_scene_generations_pkey" PRIMARY KEY (id);
ALTER TABLE "provider_attempt_costs" ADD CONSTRAINT "provider_attempt_costs_pkey" PRIMARY KEY (attempt_id);
ALTER TABLE "provider_attempt_usage" ADD CONSTRAINT "provider_attempt_usage_pkey" PRIMARY KEY (attempt_id);
ALTER TABLE "provider_attempts" ADD CONSTRAINT "provider_attempts_attempt_number_check" CHECK (attempt_number >= 0);
ALTER TABLE "provider_attempts" ADD CONSTRAINT "provider_attempts_execution_id_attempt_number_key" UNIQUE (execution_id, attempt_number);
ALTER TABLE "provider_attempts" ADD CONSTRAINT "provider_attempts_pkey" PRIMARY KEY (attempt_id);
ALTER TABLE "provider_execution_dispatches" ADD CONSTRAINT "provider_execution_dispatches_job_id_key" UNIQUE (job_id);
ALTER TABLE "provider_execution_dispatches" ADD CONSTRAINT "provider_execution_dispatches_pkey" PRIMARY KEY (dispatch_id);
ALTER TABLE "provider_execution_dispatches" ADD CONSTRAINT "provider_execution_dispatches_status_check" CHECK (status = 'DISPATCHED'::text);
ALTER TABLE "provider_execution_envelopes" ADD CONSTRAINT "provider_execution_envelopes_payload_reference_key" UNIQUE (payload_reference);
ALTER TABLE "provider_execution_envelopes" ADD CONSTRAINT "provider_execution_envelopes_pkey" PRIMARY KEY (envelope_id);
ALTER TABLE "provider_execution_finalizations" ADD CONSTRAINT "provider_execution_finalizations_dispatch_id_key" UNIQUE (dispatch_id);
ALTER TABLE "provider_execution_finalizations" ADD CONSTRAINT "provider_execution_finalizations_duration_ms_check" CHECK (duration_ms >= 0);
ALTER TABLE "provider_execution_finalizations" ADD CONSTRAINT "provider_execution_finalizations_execution_id_key" UNIQUE (execution_id);
ALTER TABLE "provider_execution_finalizations" ADD CONSTRAINT "provider_execution_finalizations_execution_result_id_key" UNIQUE (execution_result_id);
ALTER TABLE "provider_execution_finalizations" ADD CONSTRAINT "provider_execution_finalizations_outbox_job_id_key" UNIQUE (outbox_job_id);
ALTER TABLE "provider_execution_finalizations" ADD CONSTRAINT "provider_execution_finalizations_pkey" PRIMARY KEY (finalization_id);
ALTER TABLE "provider_execution_finalizations" ADD CONSTRAINT "provider_execution_finalizations_terminal_status_check" CHECK (terminal_status = ANY (ARRAY['SUCCEEDED'::text, 'FAILED'::text]));
ALTER TABLE "provider_executions" ADD CONSTRAINT "provider_executions_idempotency_key_key" UNIQUE (idempotency_key);
ALTER TABLE "provider_executions" ADD CONSTRAINT "provider_executions_pkey" PRIMARY KEY (execution_id);
ALTER TABLE "provider_finalization_costs" ADD CONSTRAINT "provider_finalization_costs_pkey" PRIMARY KEY (finalization_id);
ALTER TABLE "provider_finalization_usage" ADD CONSTRAINT "provider_finalization_usage_pkey" PRIMARY KEY (finalization_id);
ALTER TABLE "provider_outbox_jobs" ADD CONSTRAINT "provider_outbox_jobs_attempt_count_check" CHECK (attempt_count >= 0);
ALTER TABLE "provider_outbox_jobs" ADD CONSTRAINT "provider_outbox_jobs_check" CHECK (status = 'CLAIMED'::text AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL OR status <> 'CLAIMED'::text AND lease_owner IS NULL AND lease_expires_at IS NULL);
ALTER TABLE "provider_outbox_jobs" ADD CONSTRAINT "provider_outbox_jobs_check1" CHECK (status <> 'DEAD_LETTER'::text OR dead_letter_reason IS NOT NULL AND dead_letter_at IS NOT NULL);
ALTER TABLE "provider_outbox_jobs" ADD CONSTRAINT "provider_outbox_jobs_execution_id_key" UNIQUE (execution_id);
ALTER TABLE "provider_outbox_jobs" ADD CONSTRAINT "provider_outbox_jobs_pkey" PRIMARY KEY (job_id);
ALTER TABLE "provider_outbox_jobs" ADD CONSTRAINT "provider_outbox_jobs_retry_delay_ms_check" CHECK (retry_delay_ms IS NULL OR retry_delay_ms >= 0);
ALTER TABLE "provider_terminal_ledger_records" ADD CONSTRAINT "provider_terminal_ledger_records_finalization_id_key" UNIQUE (finalization_id);
ALTER TABLE "provider_terminal_ledger_records" ADD CONSTRAINT "provider_terminal_ledger_records_pkey" PRIMARY KEY (execution_id);
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_generation_input_fingerprint_check" CHECK (generation_input_fingerprint IS NULL OR generation_input_fingerprint ~ '^sha256:[a-f0-9]{64}$'::text);
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_generation_input_pair_check" CHECK (generation_input_capsule IS NULL AND generation_input_fingerprint IS NULL OR generation_input_capsule IS NOT NULL AND generation_input_fingerprint IS NOT NULL);
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_pkey" PRIMARY KEY (id);
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_pkey" PRIMARY KEY (id);
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_user_id_unique" UNIQUE (workspace_id, user_id);
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_org_id_slug_unique" UNIQUE (org_id, slug);
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_pkey" PRIMARY KEY (id);
ALTER TABLE "ai_stories" ADD CONSTRAINT "ai_stories_campaign_id_fkey" FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
ALTER TABLE "ai_stories" ADD CONSTRAINT "ai_stories_current_version_fk" FOREIGN KEY (current_version_id) REFERENCES ai_story_versions(id) ON DELETE SET NULL;
ALTER TABLE "ai_stories" ADD CONSTRAINT "ai_stories_org_id_fkey" FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE "ai_stories" ADD CONSTRAINT "ai_stories_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE "ai_story_animation_packages" ADD CONSTRAINT "ai_story_animation_packages_campaign_id_fkey" FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
ALTER TABLE "ai_story_animation_packages" ADD CONSTRAINT "ai_story_animation_packages_org_id_fkey" FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE "ai_story_animation_packages" ADD CONSTRAINT "ai_story_animation_packages_story_id_fkey" FOREIGN KEY (story_id) REFERENCES ai_stories(id) ON DELETE CASCADE;
ALTER TABLE "ai_story_animation_packages" ADD CONSTRAINT "ai_story_animation_packages_story_version_id_fkey" FOREIGN KEY (story_version_id) REFERENCES ai_story_versions(id) ON DELETE CASCADE;
ALTER TABLE "ai_story_animation_packages" ADD CONSTRAINT "ai_story_animation_packages_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE "ai_story_assembly_artifacts" ADD CONSTRAINT "ai_story_assembly_artifacts_animation_package_id_fkey" FOREIGN KEY (animation_package_id) REFERENCES ai_story_animation_packages(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_assembly_artifacts" ADD CONSTRAINT "ai_story_assembly_artifacts_assembly_job_id_fkey" FOREIGN KEY (assembly_job_id) REFERENCES ai_story_assembly_jobs(assembly_job_id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_assembly_artifacts" ADD CONSTRAINT "ai_story_assembly_artifacts_campaign_id_fkey" FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_assembly_artifacts" ADD CONSTRAINT "ai_story_assembly_artifacts_execution_plan_id_fkey" FOREIGN KEY (execution_plan_id) REFERENCES ai_story_execution_plans(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_assembly_artifacts" ADD CONSTRAINT "ai_story_assembly_artifacts_org_id_fkey" FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_assembly_artifacts" ADD CONSTRAINT "ai_story_assembly_artifacts_story_id_fkey" FOREIGN KEY (story_id) REFERENCES ai_stories(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_assembly_artifacts" ADD CONSTRAINT "ai_story_assembly_artifacts_story_version_id_fkey" FOREIGN KEY (story_version_id) REFERENCES ai_story_versions(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_assembly_artifacts" ADD CONSTRAINT "ai_story_assembly_artifacts_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_assembly_definitions" ADD CONSTRAINT "ai_story_assembly_definitions_animation_package_id_fkey" FOREIGN KEY (animation_package_id) REFERENCES ai_story_animation_packages(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_assembly_definitions" ADD CONSTRAINT "ai_story_assembly_definitions_campaign_id_fkey" FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_assembly_definitions" ADD CONSTRAINT "ai_story_assembly_definitions_execution_plan_id_fkey" FOREIGN KEY (execution_plan_id) REFERENCES ai_story_execution_plans(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_assembly_definitions" ADD CONSTRAINT "ai_story_assembly_definitions_org_id_fkey" FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_assembly_definitions" ADD CONSTRAINT "ai_story_assembly_definitions_story_id_fkey" FOREIGN KEY (story_id) REFERENCES ai_stories(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_assembly_definitions" ADD CONSTRAINT "ai_story_assembly_definitions_story_version_id_fkey" FOREIGN KEY (story_version_id) REFERENCES ai_story_versions(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_assembly_definitions" ADD CONSTRAINT "ai_story_assembly_definitions_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_assembly_job_facts" ADD CONSTRAINT "ai_story_assembly_job_facts_animation_package_id_fkey" FOREIGN KEY (animation_package_id) REFERENCES ai_story_animation_packages(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_assembly_job_facts" ADD CONSTRAINT "ai_story_assembly_job_facts_assembly_job_id_fkey" FOREIGN KEY (assembly_job_id) REFERENCES ai_story_assembly_jobs(assembly_job_id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_assembly_job_facts" ADD CONSTRAINT "ai_story_assembly_job_facts_campaign_id_fkey" FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_assembly_job_facts" ADD CONSTRAINT "ai_story_assembly_job_facts_execution_plan_id_fkey" FOREIGN KEY (execution_plan_id) REFERENCES ai_story_execution_plans(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_assembly_job_facts" ADD CONSTRAINT "ai_story_assembly_job_facts_org_id_fkey" FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_assembly_job_facts" ADD CONSTRAINT "ai_story_assembly_job_facts_story_id_fkey" FOREIGN KEY (story_id) REFERENCES ai_stories(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_assembly_job_facts" ADD CONSTRAINT "ai_story_assembly_job_facts_story_version_id_fkey" FOREIGN KEY (story_version_id) REFERENCES ai_story_versions(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_assembly_job_facts" ADD CONSTRAINT "ai_story_assembly_job_facts_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_assembly_jobs" ADD CONSTRAINT "ai_story_assembly_jobs_animation_package_id_fkey" FOREIGN KEY (animation_package_id) REFERENCES ai_story_animation_packages(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_assembly_jobs" ADD CONSTRAINT "ai_story_assembly_jobs_assembly_definition_id_fkey" FOREIGN KEY (assembly_definition_id) REFERENCES ai_story_assembly_definitions(assembly_definition_id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_assembly_jobs" ADD CONSTRAINT "ai_story_assembly_jobs_campaign_id_fkey" FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_assembly_jobs" ADD CONSTRAINT "ai_story_assembly_jobs_execution_plan_id_fkey" FOREIGN KEY (execution_plan_id) REFERENCES ai_story_execution_plans(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_assembly_jobs" ADD CONSTRAINT "ai_story_assembly_jobs_org_id_fkey" FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_assembly_jobs" ADD CONSTRAINT "ai_story_assembly_jobs_story_id_fkey" FOREIGN KEY (story_id) REFERENCES ai_stories(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_assembly_jobs" ADD CONSTRAINT "ai_story_assembly_jobs_story_version_id_fkey" FOREIGN KEY (story_version_id) REFERENCES ai_story_versions(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_assembly_jobs" ADD CONSTRAINT "ai_story_assembly_jobs_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_assembly_scene_memberships" ADD CONSTRAINT "ai_story_assembly_scene_memberships_animation_package_id_fkey" FOREIGN KEY (animation_package_id) REFERENCES ai_story_animation_packages(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_assembly_scene_memberships" ADD CONSTRAINT "ai_story_assembly_scene_memberships_assembly_definition_id_fkey" FOREIGN KEY (assembly_definition_id) REFERENCES ai_story_assembly_definitions(assembly_definition_id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_assembly_scene_memberships" ADD CONSTRAINT "ai_story_assembly_scene_memberships_campaign_id_fkey" FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_assembly_scene_memberships" ADD CONSTRAINT "ai_story_assembly_scene_memberships_execution_plan_id_fkey" FOREIGN KEY (execution_plan_id) REFERENCES ai_story_execution_plans(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_assembly_scene_memberships" ADD CONSTRAINT "ai_story_assembly_scene_memberships_org_id_fkey" FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_assembly_scene_memberships" ADD CONSTRAINT "ai_story_assembly_scene_memberships_scene_execution_id_fkey" FOREIGN KEY (scene_execution_id) REFERENCES ai_story_scene_executions(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_assembly_scene_memberships" ADD CONSTRAINT "ai_story_assembly_scene_memberships_story_id_fkey" FOREIGN KEY (story_id) REFERENCES ai_stories(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_assembly_scene_memberships" ADD CONSTRAINT "ai_story_assembly_scene_memberships_story_version_id_fkey" FOREIGN KEY (story_version_id) REFERENCES ai_story_versions(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_assembly_scene_memberships" ADD CONSTRAINT "ai_story_assembly_scene_memberships_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_asset_links" ADD CONSTRAINT "ai_story_asset_links_asset_id_fkey" FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_asset_links" ADD CONSTRAINT "ai_story_asset_links_story_id_fkey" FOREIGN KEY (story_id) REFERENCES ai_stories(id) ON DELETE CASCADE;
ALTER TABLE "ai_story_creative_contexts" ADD CONSTRAINT "ai_story_creative_contexts_campaign_id_fkey" FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
ALTER TABLE "ai_story_creative_contexts" ADD CONSTRAINT "ai_story_creative_contexts_org_id_fkey" FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE "ai_story_creative_contexts" ADD CONSTRAINT "ai_story_creative_contexts_story_id_fkey" FOREIGN KEY (story_id) REFERENCES ai_stories(id) ON DELETE CASCADE;
ALTER TABLE "ai_story_creative_contexts" ADD CONSTRAINT "ai_story_creative_contexts_story_version_id_fkey" FOREIGN KEY (story_version_id) REFERENCES ai_story_versions(id) ON DELETE CASCADE;
ALTER TABLE "ai_story_creative_contexts" ADD CONSTRAINT "ai_story_creative_contexts_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE "ai_story_durable_scene_media_attestations" ADD CONSTRAINT "ai_story_durable_scene_media_attestat_animation_package_id_fkey" FOREIGN KEY (animation_package_id) REFERENCES ai_story_animation_packages(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_durable_scene_media_attestations" ADD CONSTRAINT "ai_story_durable_scene_media_attestatio_scene_execution_id_fkey" FOREIGN KEY (scene_execution_id) REFERENCES ai_story_scene_executions(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_durable_scene_media_attestations" ADD CONSTRAINT "ai_story_durable_scene_media_attestation_execution_plan_id_fkey" FOREIGN KEY (execution_plan_id) REFERENCES ai_story_execution_plans(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_durable_scene_media_attestations" ADD CONSTRAINT "ai_story_durable_scene_media_attestations_campaign_id_fkey" FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_durable_scene_media_attestations" ADD CONSTRAINT "ai_story_durable_scene_media_attestations_org_id_fkey" FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_durable_scene_media_attestations" ADD CONSTRAINT "ai_story_durable_scene_media_attestations_scene_result_id_fkey" FOREIGN KEY (scene_result_id) REFERENCES ai_story_scene_results(scene_result_id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_durable_scene_media_attestations" ADD CONSTRAINT "ai_story_durable_scene_media_attestations_story_id_fkey" FOREIGN KEY (story_id) REFERENCES ai_stories(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_durable_scene_media_attestations" ADD CONSTRAINT "ai_story_durable_scene_media_attestations_story_version_id_fkey" FOREIGN KEY (story_version_id) REFERENCES ai_story_versions(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_durable_scene_media_attestations" ADD CONSTRAINT "ai_story_durable_scene_media_attestations_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_execute_verifications" ADD CONSTRAINT "ai_story_execute_verifications_execution_plan_id_fkey" FOREIGN KEY (execution_plan_id) REFERENCES ai_story_execution_plans(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_execute_verifications" ADD CONSTRAINT "ai_story_execute_verifications_outbox_job_id_fkey" FOREIGN KEY (outbox_job_id) REFERENCES provider_outbox_jobs(job_id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_execute_verifications" ADD CONSTRAINT "ai_story_execute_verifications_runtime_authorization_id_fkey" FOREIGN KEY (runtime_authorization_id) REFERENCES ai_story_runtime_authorized_facts(runtime_authorization_id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_execute_verifications" ADD CONSTRAINT "ai_story_execute_verifications_scene_execution_id_fkey" FOREIGN KEY (scene_execution_id) REFERENCES ai_story_scene_executions(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_execute_verifications" ADD CONSTRAINT "ai_story_execute_verifications_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_execution_jobs" ADD CONSTRAINT "ai_story_execution_jobs_animation_package_id_fkey" FOREIGN KEY (animation_package_id) REFERENCES ai_story_animation_packages(id) ON DELETE CASCADE;
ALTER TABLE "ai_story_execution_jobs" ADD CONSTRAINT "ai_story_execution_jobs_campaign_id_fkey" FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
ALTER TABLE "ai_story_execution_jobs" ADD CONSTRAINT "ai_story_execution_jobs_org_id_fkey" FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE "ai_story_execution_jobs" ADD CONSTRAINT "ai_story_execution_jobs_story_id_fkey" FOREIGN KEY (story_id) REFERENCES ai_stories(id) ON DELETE CASCADE;
ALTER TABLE "ai_story_execution_jobs" ADD CONSTRAINT "ai_story_execution_jobs_task_id_fkey" FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL;
ALTER TABLE "ai_story_execution_jobs" ADD CONSTRAINT "ai_story_execution_jobs_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE "ai_story_execution_outputs" ADD CONSTRAINT "ai_story_execution_outputs_animation_package_id_fkey" FOREIGN KEY (animation_package_id) REFERENCES ai_story_animation_packages(id) ON DELETE CASCADE;
ALTER TABLE "ai_story_execution_outputs" ADD CONSTRAINT "ai_story_execution_outputs_campaign_id_fkey" FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
ALTER TABLE "ai_story_execution_outputs" ADD CONSTRAINT "ai_story_execution_outputs_creative_id_fkey" FOREIGN KEY (creative_id) REFERENCES creatives(id) ON DELETE SET NULL;
ALTER TABLE "ai_story_execution_outputs" ADD CONSTRAINT "ai_story_execution_outputs_execution_job_id_fkey" FOREIGN KEY (execution_job_id) REFERENCES ai_story_execution_jobs(id) ON DELETE CASCADE;
ALTER TABLE "ai_story_execution_outputs" ADD CONSTRAINT "ai_story_execution_outputs_org_id_fkey" FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE "ai_story_execution_outputs" ADD CONSTRAINT "ai_story_execution_outputs_story_id_fkey" FOREIGN KEY (story_id) REFERENCES ai_stories(id) ON DELETE CASCADE;
ALTER TABLE "ai_story_execution_outputs" ADD CONSTRAINT "ai_story_execution_outputs_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE "ai_story_execution_plans" ADD CONSTRAINT "ai_story_execution_plans_animation_package_id_fkey" FOREIGN KEY (animation_package_id) REFERENCES ai_story_animation_packages(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_execution_plans" ADD CONSTRAINT "ai_story_execution_plans_campaign_id_fkey" FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_execution_plans" ADD CONSTRAINT "ai_story_execution_plans_org_id_fkey" FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_execution_plans" ADD CONSTRAINT "ai_story_execution_plans_story_id_fkey" FOREIGN KEY (story_id) REFERENCES ai_stories(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_execution_plans" ADD CONSTRAINT "ai_story_execution_plans_story_version_id_fkey" FOREIGN KEY (story_version_id) REFERENCES ai_story_versions(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_execution_plans" ADD CONSTRAINT "ai_story_execution_plans_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_final_story_results" ADD CONSTRAINT "ai_story_final_story_results_animation_package_id_fkey" FOREIGN KEY (animation_package_id) REFERENCES ai_story_animation_packages(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_final_story_results" ADD CONSTRAINT "ai_story_final_story_results_assembly_artifact_id_fkey" FOREIGN KEY (assembly_artifact_id) REFERENCES ai_story_assembly_artifacts(artifact_id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_final_story_results" ADD CONSTRAINT "ai_story_final_story_results_assembly_definition_id_fkey" FOREIGN KEY (assembly_definition_id) REFERENCES ai_story_assembly_definitions(assembly_definition_id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_final_story_results" ADD CONSTRAINT "ai_story_final_story_results_assembly_job_id_fkey" FOREIGN KEY (assembly_job_id) REFERENCES ai_story_assembly_jobs(assembly_job_id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_final_story_results" ADD CONSTRAINT "ai_story_final_story_results_campaign_id_fkey" FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_final_story_results" ADD CONSTRAINT "ai_story_final_story_results_execution_plan_id_fkey" FOREIGN KEY (execution_plan_id) REFERENCES ai_story_execution_plans(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_final_story_results" ADD CONSTRAINT "ai_story_final_story_results_org_id_fkey" FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_final_story_results" ADD CONSTRAINT "ai_story_final_story_results_story_id_fkey" FOREIGN KEY (story_id) REFERENCES ai_stories(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_final_story_results" ADD CONSTRAINT "ai_story_final_story_results_story_version_id_fkey" FOREIGN KEY (story_version_id) REFERENCES ai_story_versions(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_final_story_results" ADD CONSTRAINT "ai_story_final_story_results_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_generated_scene_reviews" ADD CONSTRAINT "ai_story_generated_scene_reviews_campaign_id_fkey" FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_generated_scene_reviews" ADD CONSTRAINT "ai_story_generated_scene_reviews_execution_plan_id_fkey" FOREIGN KEY (execution_plan_id) REFERENCES ai_story_execution_plans(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_generated_scene_reviews" ADD CONSTRAINT "ai_story_generated_scene_reviews_org_id_fkey" FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_generated_scene_reviews" ADD CONSTRAINT "ai_story_generated_scene_reviews_scene_execution_id_fkey" FOREIGN KEY (scene_execution_id) REFERENCES ai_story_scene_executions(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_generated_scene_reviews" ADD CONSTRAINT "ai_story_generated_scene_reviews_scene_result_id_fkey" FOREIGN KEY (scene_result_id) REFERENCES ai_story_scene_results(scene_result_id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_generated_scene_reviews" ADD CONSTRAINT "ai_story_generated_scene_reviews_story_id_fkey" FOREIGN KEY (story_id) REFERENCES ai_stories(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_generated_scene_reviews" ADD CONSTRAINT "ai_story_generated_scene_reviews_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_review_opened_facts" ADD CONSTRAINT "ai_story_review_opened_facts_animation_package_id_fkey" FOREIGN KEY (animation_package_id) REFERENCES ai_story_animation_packages(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_review_opened_facts" ADD CONSTRAINT "ai_story_review_opened_facts_campaign_id_fkey" FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_review_opened_facts" ADD CONSTRAINT "ai_story_review_opened_facts_execution_plan_id_fkey" FOREIGN KEY (execution_plan_id) REFERENCES ai_story_execution_plans(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_review_opened_facts" ADD CONSTRAINT "ai_story_review_opened_facts_org_id_fkey" FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_review_opened_facts" ADD CONSTRAINT "ai_story_review_opened_facts_story_id_fkey" FOREIGN KEY (story_id) REFERENCES ai_stories(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_review_opened_facts" ADD CONSTRAINT "ai_story_review_opened_facts_story_version_id_fkey" FOREIGN KEY (story_version_id) REFERENCES ai_story_versions(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_review_opened_facts" ADD CONSTRAINT "ai_story_review_opened_facts_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_runtime_authorized_facts" ADD CONSTRAINT "ai_story_runtime_authorized_facts_animation_package_id_fkey" FOREIGN KEY (animation_package_id) REFERENCES ai_story_animation_packages(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_runtime_authorized_facts" ADD CONSTRAINT "ai_story_runtime_authorized_facts_campaign_id_fkey" FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_runtime_authorized_facts" ADD CONSTRAINT "ai_story_runtime_authorized_facts_execution_plan_id_fkey" FOREIGN KEY (execution_plan_id) REFERENCES ai_story_execution_plans(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_runtime_authorized_facts" ADD CONSTRAINT "ai_story_runtime_authorized_facts_org_id_fkey" FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_runtime_authorized_facts" ADD CONSTRAINT "ai_story_runtime_authorized_facts_story_id_fkey" FOREIGN KEY (story_id) REFERENCES ai_stories(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_runtime_authorized_facts" ADD CONSTRAINT "ai_story_runtime_authorized_facts_story_version_id_fkey" FOREIGN KEY (story_version_id) REFERENCES ai_story_versions(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_runtime_authorized_facts" ADD CONSTRAINT "ai_story_runtime_authorized_facts_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_attempt_input_revisions" ADD CONSTRAINT "ai_story_scene_attempt_input_revisions_campaign_id_fkey" FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_attempt_input_revisions" ADD CONSTRAINT "ai_story_scene_attempt_input_revisions_execution_plan_id_fkey" FOREIGN KEY (execution_plan_id) REFERENCES ai_story_execution_plans(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_attempt_input_revisions" ADD CONSTRAINT "ai_story_scene_attempt_input_revisions_org_id_fkey" FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_attempt_input_revisions" ADD CONSTRAINT "ai_story_scene_attempt_input_revisions_parent_revision_id_fkey" FOREIGN KEY (parent_revision_id) REFERENCES ai_story_scene_attempt_input_revisions(retry_input_revision_id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_attempt_input_revisions" ADD CONSTRAINT "ai_story_scene_attempt_input_revisions_product_asset_id_fkey" FOREIGN KEY (product_asset_id) REFERENCES assets(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_attempt_input_revisions" ADD CONSTRAINT "ai_story_scene_attempt_input_revisions_scene_execution_id_fkey" FOREIGN KEY (scene_execution_id) REFERENCES ai_story_scene_executions(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_attempt_input_revisions" ADD CONSTRAINT "ai_story_scene_attempt_input_revisions_source_review_id_fkey" FOREIGN KEY (source_review_id) REFERENCES ai_story_generated_scene_reviews(generated_scene_review_id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_attempt_input_revisions" ADD CONSTRAINT "ai_story_scene_attempt_input_revisions_story_id_fkey" FOREIGN KEY (story_id) REFERENCES ai_stories(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_attempt_input_revisions" ADD CONSTRAINT "ai_story_scene_attempt_input_revisions_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_attempt_input_revisions" ADD CONSTRAINT "ai_story_scene_retry_revision_parent_v1" FOREIGN KEY (parent_revision_id) REFERENCES ai_story_scene_attempt_input_revisions(retry_input_revision_id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_executions" ADD CONSTRAINT "ai_story_scene_executions_animation_package_id_fkey" FOREIGN KEY (animation_package_id) REFERENCES ai_story_animation_packages(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_executions" ADD CONSTRAINT "ai_story_scene_executions_campaign_id_fkey" FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_executions" ADD CONSTRAINT "ai_story_scene_executions_execution_plan_id_fkey" FOREIGN KEY (execution_plan_id) REFERENCES ai_story_execution_plans(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_executions" ADD CONSTRAINT "ai_story_scene_executions_instruction_hash_fkey" FOREIGN KEY (instruction_hash) REFERENCES ai_story_scene_instruction_snapshots(content_hash) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_executions" ADD CONSTRAINT "ai_story_scene_executions_org_id_fkey" FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_executions" ADD CONSTRAINT "ai_story_scene_executions_story_id_fkey" FOREIGN KEY (story_id) REFERENCES ai_stories(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_executions" ADD CONSTRAINT "ai_story_scene_executions_story_version_id_fkey" FOREIGN KEY (story_version_id) REFERENCES ai_story_versions(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_executions" ADD CONSTRAINT "ai_story_scene_executions_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_instruction_snapshots" ADD CONSTRAINT "ai_story_scene_instruction_snapshots_org_id_fkey" FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_instruction_snapshots" ADD CONSTRAINT "ai_story_scene_instruction_snapshots_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_intent_review_facts" ADD CONSTRAINT "ai_story_scene_intent_review_facts_animation_package_id_fkey" FOREIGN KEY (animation_package_id) REFERENCES ai_story_animation_packages(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_intent_review_facts" ADD CONSTRAINT "ai_story_scene_intent_review_facts_campaign_id_fkey" FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_intent_review_facts" ADD CONSTRAINT "ai_story_scene_intent_review_facts_execution_plan_id_fkey" FOREIGN KEY (execution_plan_id) REFERENCES ai_story_execution_plans(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_intent_review_facts" ADD CONSTRAINT "ai_story_scene_intent_review_facts_instruction_hash_fkey" FOREIGN KEY (instruction_hash) REFERENCES ai_story_scene_instruction_snapshots(content_hash) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_intent_review_facts" ADD CONSTRAINT "ai_story_scene_intent_review_facts_org_id_fkey" FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_intent_review_facts" ADD CONSTRAINT "ai_story_scene_intent_review_facts_scene_execution_id_fkey" FOREIGN KEY (scene_execution_id) REFERENCES ai_story_scene_executions(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_intent_review_facts" ADD CONSTRAINT "ai_story_scene_intent_review_facts_story_id_fkey" FOREIGN KEY (story_id) REFERENCES ai_stories(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_intent_review_facts" ADD CONSTRAINT "ai_story_scene_intent_review_facts_story_version_id_fkey" FOREIGN KEY (story_version_id) REFERENCES ai_story_versions(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_intent_review_facts" ADD CONSTRAINT "ai_story_scene_intent_review_facts_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_intent_validation_results" ADD CONSTRAINT "ai_story_scene_intent_validation_result_scene_execution_id_fkey" FOREIGN KEY (scene_execution_id) REFERENCES ai_story_scene_executions(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_intent_validation_results" ADD CONSTRAINT "ai_story_scene_intent_validation_results_execution_plan_id_fkey" FOREIGN KEY (execution_plan_id) REFERENCES ai_story_execution_plans(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_intent_validation_results" ADD CONSTRAINT "ai_story_scene_intent_validation_results_org_id_fkey" FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_intent_validation_results" ADD CONSTRAINT "ai_story_scene_intent_validation_results_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_projection_correlations" ADD CONSTRAINT "ai_story_scene_projection_corre_worker_execution_result_id_fkey" FOREIGN KEY (worker_execution_result_id) REFERENCES ai_story_worker_execution_results(worker_execution_result_id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_projection_correlations" ADD CONSTRAINT "ai_story_scene_projection_correlatio_provider_execution_id_fkey" FOREIGN KEY (provider_execution_id) REFERENCES provider_executions(execution_id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_projection_correlations" ADD CONSTRAINT "ai_story_scene_projection_correlations_dispatch_id_fkey" FOREIGN KEY (dispatch_id) REFERENCES provider_execution_dispatches(dispatch_id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_projection_correlations" ADD CONSTRAINT "ai_story_scene_projection_correlations_org_id_fkey" FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_projection_correlations" ADD CONSTRAINT "ai_story_scene_projection_correlations_outbox_job_id_fkey" FOREIGN KEY (outbox_job_id) REFERENCES provider_outbox_jobs(job_id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_projection_correlations" ADD CONSTRAINT "ai_story_scene_projection_correlations_scene_execution_id_fkey" FOREIGN KEY (scene_execution_id) REFERENCES ai_story_scene_executions(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_projection_correlations" ADD CONSTRAINT "ai_story_scene_projection_correlations_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_release_states" ADD CONSTRAINT "ai_story_scene_release_states_execution_plan_id_fkey" FOREIGN KEY (execution_plan_id) REFERENCES ai_story_execution_plans(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_release_states" ADD CONSTRAINT "ai_story_scene_release_states_gate_scene_execution_id_fkey" FOREIGN KEY (gate_scene_execution_id) REFERENCES ai_story_scene_executions(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_release_states" ADD CONSTRAINT "ai_story_scene_release_states_gate_scene_result_id_fkey" FOREIGN KEY (gate_scene_result_id) REFERENCES ai_story_scene_results(scene_result_id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_release_states" ADD CONSTRAINT "ai_story_scene_release_states_runtime_authorization_id_fkey" FOREIGN KEY (runtime_authorization_id) REFERENCES ai_story_runtime_authorized_facts(runtime_authorization_id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_release_states" ADD CONSTRAINT "ai_story_scene_release_states_scene_execution_id_fkey" FOREIGN KEY (scene_execution_id) REFERENCES ai_story_scene_executions(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_release_states" ADD CONSTRAINT "ai_story_scene_release_states_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_results" ADD CONSTRAINT "ai_story_scene_results_execution_plan_id_fkey" FOREIGN KEY (execution_plan_id) REFERENCES ai_story_execution_plans(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_results" ADD CONSTRAINT "ai_story_scene_results_org_id_fkey" FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_results" ADD CONSTRAINT "ai_story_scene_results_projection_correlation_id_fkey" FOREIGN KEY (projection_correlation_id) REFERENCES ai_story_scene_projection_correlations(projection_correlation_id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_results" ADD CONSTRAINT "ai_story_scene_results_scene_execution_id_fkey" FOREIGN KEY (scene_execution_id) REFERENCES ai_story_scene_executions(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_results" ADD CONSTRAINT "ai_story_scene_results_worker_execution_result_id_fkey" FOREIGN KEY (worker_execution_result_id) REFERENCES ai_story_worker_execution_results(worker_execution_result_id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_results" ADD CONSTRAINT "ai_story_scene_results_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_retry_authorizations" ADD CONSTRAINT "ai_story_scene_retry_authorization_retry_input_revision_id_fkey" FOREIGN KEY (retry_input_revision_id) REFERENCES ai_story_scene_attempt_input_revisions(retry_input_revision_id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_retry_authorizations" ADD CONSTRAINT "ai_story_scene_retry_authorizations_campaign_id_fkey" FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_retry_authorizations" ADD CONSTRAINT "ai_story_scene_retry_authorizations_execution_plan_id_fkey" FOREIGN KEY (execution_plan_id) REFERENCES ai_story_execution_plans(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_retry_authorizations" ADD CONSTRAINT "ai_story_scene_retry_authorizations_org_id_fkey" FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_retry_authorizations" ADD CONSTRAINT "ai_story_scene_retry_authorizations_scene_execution_id_fkey" FOREIGN KEY (scene_execution_id) REFERENCES ai_story_scene_executions(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_retry_authorizations" ADD CONSTRAINT "ai_story_scene_retry_authorizations_source_review_id_fkey" FOREIGN KEY (source_review_id) REFERENCES ai_story_generated_scene_reviews(generated_scene_review_id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_retry_authorizations" ADD CONSTRAINT "ai_story_scene_retry_authorizations_story_id_fkey" FOREIGN KEY (story_id) REFERENCES ai_stories(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_retry_authorizations" ADD CONSTRAINT "ai_story_scene_retry_authorizations_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_retry_eligibility_facts" ADD CONSTRAINT "ai_story_scene_retry_eligibility_facts_campaign_id_fkey" FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_retry_eligibility_facts" ADD CONSTRAINT "ai_story_scene_retry_eligibility_facts_execution_plan_id_fkey" FOREIGN KEY (execution_plan_id) REFERENCES ai_story_execution_plans(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_retry_eligibility_facts" ADD CONSTRAINT "ai_story_scene_retry_eligibility_facts_org_id_fkey" FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_retry_eligibility_facts" ADD CONSTRAINT "ai_story_scene_retry_eligibility_facts_scene_execution_id_fkey" FOREIGN KEY (scene_execution_id) REFERENCES ai_story_scene_executions(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_retry_eligibility_facts" ADD CONSTRAINT "ai_story_scene_retry_eligibility_facts_source_review_id_fkey" FOREIGN KEY (source_review_id) REFERENCES ai_story_generated_scene_reviews(generated_scene_review_id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_retry_eligibility_facts" ADD CONSTRAINT "ai_story_scene_retry_eligibility_facts_story_id_fkey" FOREIGN KEY (story_id) REFERENCES ai_stories(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_retry_eligibility_facts" ADD CONSTRAINT "ai_story_scene_retry_eligibility_facts_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_routing_decisions" ADD CONSTRAINT "ai_story_scene_routing_decisions_animation_package_id_fkey" FOREIGN KEY (animation_package_id) REFERENCES ai_story_animation_packages(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_routing_decisions" ADD CONSTRAINT "ai_story_scene_routing_decisions_campaign_id_fkey" FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_routing_decisions" ADD CONSTRAINT "ai_story_scene_routing_decisions_execution_plan_id_fkey" FOREIGN KEY (execution_plan_id) REFERENCES ai_story_execution_plans(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_routing_decisions" ADD CONSTRAINT "ai_story_scene_routing_decisions_org_id_fkey" FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_routing_decisions" ADD CONSTRAINT "ai_story_scene_routing_decisions_runtime_authorization_id_fkey" FOREIGN KEY (runtime_authorization_id) REFERENCES ai_story_runtime_authorized_facts(runtime_authorization_id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_routing_decisions" ADD CONSTRAINT "ai_story_scene_routing_decisions_scene_execution_id_fkey" FOREIGN KEY (scene_execution_id) REFERENCES ai_story_scene_executions(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_routing_decisions" ADD CONSTRAINT "ai_story_scene_routing_decisions_story_id_fkey" FOREIGN KEY (story_id) REFERENCES ai_stories(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_routing_decisions" ADD CONSTRAINT "ai_story_scene_routing_decisions_story_version_id_fkey" FOREIGN KEY (story_version_id) REFERENCES ai_story_versions(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_routing_decisions" ADD CONSTRAINT "ai_story_scene_routing_decisions_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_scheduling_correlations" ADD CONSTRAINT "ai_story_scene_scheduling_correla_runtime_authorization_id_fkey" FOREIGN KEY (runtime_authorization_id) REFERENCES ai_story_runtime_authorized_facts(runtime_authorization_id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_scheduling_correlations" ADD CONSTRAINT "ai_story_scene_scheduling_correlatio_provider_execution_id_fkey" FOREIGN KEY (provider_execution_id) REFERENCES provider_executions(execution_id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_scheduling_correlations" ADD CONSTRAINT "ai_story_scene_scheduling_correlation_animation_package_id_fkey" FOREIGN KEY (animation_package_id) REFERENCES ai_story_animation_packages(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_scheduling_correlations" ADD CONSTRAINT "ai_story_scene_scheduling_correlations_campaign_id_fkey" FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_scheduling_correlations" ADD CONSTRAINT "ai_story_scene_scheduling_correlations_envelope_id_fkey" FOREIGN KEY (envelope_id) REFERENCES provider_execution_envelopes(envelope_id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_scheduling_correlations" ADD CONSTRAINT "ai_story_scene_scheduling_correlations_execution_plan_id_fkey" FOREIGN KEY (execution_plan_id) REFERENCES ai_story_execution_plans(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_scheduling_correlations" ADD CONSTRAINT "ai_story_scene_scheduling_correlations_org_id_fkey" FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_scheduling_correlations" ADD CONSTRAINT "ai_story_scene_scheduling_correlations_outbox_job_id_fkey" FOREIGN KEY (outbox_job_id) REFERENCES provider_outbox_jobs(job_id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_scheduling_correlations" ADD CONSTRAINT "ai_story_scene_scheduling_correlations_routing_decision_id_fkey" FOREIGN KEY (routing_decision_id) REFERENCES ai_story_scene_routing_decisions(routing_decision_id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_scheduling_correlations" ADD CONSTRAINT "ai_story_scene_scheduling_correlations_scene_execution_id_fkey" FOREIGN KEY (scene_execution_id) REFERENCES ai_story_scene_executions(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_scheduling_correlations" ADD CONSTRAINT "ai_story_scene_scheduling_correlations_story_id_fkey" FOREIGN KEY (story_id) REFERENCES ai_stories(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_scheduling_correlations" ADD CONSTRAINT "ai_story_scene_scheduling_correlations_story_version_id_fkey" FOREIGN KEY (story_version_id) REFERENCES ai_story_versions(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_scheduling_correlations" ADD CONSTRAINT "ai_story_scene_scheduling_correlations_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_scene_scheduling_correlations" ADD CONSTRAINT "ai_story_scene_scheduling_retry_input_revision_fk" FOREIGN KEY (retry_input_revision_id) REFERENCES ai_story_scene_attempt_input_revisions(retry_input_revision_id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_story_review_facts" ADD CONSTRAINT "ai_story_story_review_facts_animation_package_id_fkey" FOREIGN KEY (animation_package_id) REFERENCES ai_story_animation_packages(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_story_review_facts" ADD CONSTRAINT "ai_story_story_review_facts_campaign_id_fkey" FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_story_review_facts" ADD CONSTRAINT "ai_story_story_review_facts_execution_plan_id_fkey" FOREIGN KEY (execution_plan_id) REFERENCES ai_story_execution_plans(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_story_review_facts" ADD CONSTRAINT "ai_story_story_review_facts_org_id_fkey" FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_story_review_facts" ADD CONSTRAINT "ai_story_story_review_facts_story_id_fkey" FOREIGN KEY (story_id) REFERENCES ai_stories(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_story_review_facts" ADD CONSTRAINT "ai_story_story_review_facts_story_version_id_fkey" FOREIGN KEY (story_version_id) REFERENCES ai_story_versions(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_story_review_facts" ADD CONSTRAINT "ai_story_story_review_facts_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_versions" ADD CONSTRAINT "ai_story_versions_story_id_fkey" FOREIGN KEY (story_id) REFERENCES ai_stories(id) ON DELETE CASCADE;
ALTER TABLE "ai_story_worker_attempt_observations" ADD CONSTRAINT "ai_story_worker_attempt_observations_dispatch_id_fkey" FOREIGN KEY (dispatch_id) REFERENCES provider_execution_dispatches(dispatch_id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_worker_attempt_observations" ADD CONSTRAINT "ai_story_worker_attempt_observations_org_id_fkey" FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_worker_attempt_observations" ADD CONSTRAINT "ai_story_worker_attempt_observations_outbox_job_id_fkey" FOREIGN KEY (outbox_job_id) REFERENCES provider_outbox_jobs(job_id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_worker_attempt_observations" ADD CONSTRAINT "ai_story_worker_attempt_observations_provider_execution_id_fkey" FOREIGN KEY (provider_execution_id) REFERENCES provider_executions(execution_id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_worker_attempt_observations" ADD CONSTRAINT "ai_story_worker_attempt_observations_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_worker_execution_results" ADD CONSTRAINT "ai_story_worker_execution_results_dispatch_id_fkey" FOREIGN KEY (dispatch_id) REFERENCES provider_execution_dispatches(dispatch_id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_worker_execution_results" ADD CONSTRAINT "ai_story_worker_execution_results_org_id_fkey" FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_worker_execution_results" ADD CONSTRAINT "ai_story_worker_execution_results_outbox_job_id_fkey" FOREIGN KEY (outbox_job_id) REFERENCES provider_outbox_jobs(job_id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_worker_execution_results" ADD CONSTRAINT "ai_story_worker_execution_results_provider_execution_id_fkey" FOREIGN KEY (provider_execution_id) REFERENCES provider_executions(execution_id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_worker_execution_results" ADD CONSTRAINT "ai_story_worker_execution_results_routing_decision_id_fkey" FOREIGN KEY (routing_decision_id) REFERENCES ai_story_scene_routing_decisions(routing_decision_id) ON DELETE RESTRICT;
ALTER TABLE "ai_story_worker_execution_results" ADD CONSTRAINT "ai_story_worker_execution_results_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT;
ALTER TABLE "assets" ADD CONSTRAINT "assets_campaign_id_fkey" FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE SET NULL;
ALTER TABLE "assets" ADD CONSTRAINT "assets_org_id_fkey" FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE "assets" ADD CONSTRAINT "assets_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE "business_profiles" ADD CONSTRAINT "business_profiles_org_id_fkey" FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE "business_profiles" ADD CONSTRAINT "business_profiles_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_company_profile_id_fkey" FOREIGN KEY (company_profile_id) REFERENCES business_profiles(id) ON DELETE SET NULL;
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_marketing_package_id_fkey" FOREIGN KEY (marketing_package_id) REFERENCES marketing_packages(id) ON DELETE SET NULL;
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_org_id_organizations_id_fk" FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_workspace_id_workspaces_id_fk" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE "commercial_execution_authorizations" ADD CONSTRAINT "commercial_execution_authorizations_credit_reservation_id_fkey" FOREIGN KEY (credit_reservation_id) REFERENCES credit_reservations(credit_reservation_id) ON DELETE RESTRICT;
ALTER TABLE "commercial_execution_authorizations" ADD CONSTRAINT "commercial_execution_authorizations_org_id_fkey" FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE "commercial_execution_authorizations" ADD CONSTRAINT "commercial_execution_authorizations_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT;
ALTER TABLE "creatives" ADD CONSTRAINT "creatives_campaign_id_campaigns_id_fk" FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
ALTER TABLE "creatives" ADD CONSTRAINT "creatives_task_id_tasks_id_fk" FOREIGN KEY (task_id) REFERENCES tasks(id);
ALTER TABLE "credit_reservations" ADD CONSTRAINT "credit_reservations_credit_wallet_id_fkey" FOREIGN KEY (credit_wallet_id) REFERENCES credit_wallets(credit_wallet_id) ON DELETE RESTRICT;
ALTER TABLE "credit_reservations" ADD CONSTRAINT "credit_reservations_org_id_fkey" FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE "credit_reservations" ADD CONSTRAINT "credit_reservations_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT;
ALTER TABLE "credit_wallets" ADD CONSTRAINT "credit_wallets_org_id_fkey" FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE "marketing_packages" ADD CONSTRAINT "marketing_packages_campaign_id_fkey" FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
ALTER TABLE "marketing_packages" ADD CONSTRAINT "marketing_packages_org_id_fkey" FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE "marketing_packages" ADD CONSTRAINT "marketing_packages_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE "photo_scene_generations" ADD CONSTRAINT "photo_scene_generations_campaign_id_fkey" FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
ALTER TABLE "photo_scene_generations" ADD CONSTRAINT "photo_scene_generations_output_asset_id_fkey" FOREIGN KEY (output_asset_id) REFERENCES assets(id) ON DELETE SET NULL;
ALTER TABLE "photo_scene_generations" ADD CONSTRAINT "photo_scene_generations_source_asset_id_fkey" FOREIGN KEY (source_asset_id) REFERENCES assets(id) ON DELETE RESTRICT;
ALTER TABLE "provider_attempt_costs" ADD CONSTRAINT "provider_attempt_costs_attempt_id_fkey" FOREIGN KEY (attempt_id) REFERENCES provider_attempts(attempt_id) ON DELETE RESTRICT;
ALTER TABLE "provider_attempt_usage" ADD CONSTRAINT "provider_attempt_usage_attempt_id_fkey" FOREIGN KEY (attempt_id) REFERENCES provider_attempts(attempt_id) ON DELETE RESTRICT;
ALTER TABLE "provider_attempts" ADD CONSTRAINT "provider_attempts_execution_id_fkey" FOREIGN KEY (execution_id) REFERENCES provider_executions(execution_id) ON DELETE RESTRICT;
ALTER TABLE "provider_execution_dispatches" ADD CONSTRAINT "provider_execution_dispatches_envelope_id_fkey" FOREIGN KEY (envelope_id) REFERENCES provider_execution_envelopes(envelope_id) ON DELETE RESTRICT;
ALTER TABLE "provider_execution_dispatches" ADD CONSTRAINT "provider_execution_dispatches_execution_id_fkey" FOREIGN KEY (execution_id) REFERENCES provider_executions(execution_id) ON DELETE RESTRICT;
ALTER TABLE "provider_execution_dispatches" ADD CONSTRAINT "provider_execution_dispatches_job_id_fkey" FOREIGN KEY (job_id) REFERENCES provider_outbox_jobs(job_id) ON DELETE RESTRICT;
ALTER TABLE "provider_execution_finalizations" ADD CONSTRAINT "provider_execution_finalizations_dispatch_id_fkey" FOREIGN KEY (dispatch_id) REFERENCES provider_execution_dispatches(dispatch_id) ON DELETE RESTRICT;
ALTER TABLE "provider_execution_finalizations" ADD CONSTRAINT "provider_execution_finalizations_envelope_id_fkey" FOREIGN KEY (envelope_id) REFERENCES provider_execution_envelopes(envelope_id) ON DELETE RESTRICT;
ALTER TABLE "provider_execution_finalizations" ADD CONSTRAINT "provider_execution_finalizations_execution_id_fkey" FOREIGN KEY (execution_id) REFERENCES provider_executions(execution_id) ON DELETE RESTRICT;
ALTER TABLE "provider_execution_finalizations" ADD CONSTRAINT "provider_execution_finalizations_outbox_job_id_fkey" FOREIGN KEY (outbox_job_id) REFERENCES provider_outbox_jobs(job_id) ON DELETE RESTRICT;
ALTER TABLE "provider_finalization_costs" ADD CONSTRAINT "provider_finalization_costs_finalization_id_fkey" FOREIGN KEY (finalization_id) REFERENCES provider_execution_finalizations(finalization_id) ON DELETE RESTRICT;
ALTER TABLE "provider_finalization_usage" ADD CONSTRAINT "provider_finalization_usage_finalization_id_fkey" FOREIGN KEY (finalization_id) REFERENCES provider_execution_finalizations(finalization_id) ON DELETE RESTRICT;
ALTER TABLE "provider_outbox_jobs" ADD CONSTRAINT "provider_outbox_jobs_execution_id_fkey" FOREIGN KEY (execution_id) REFERENCES provider_executions(execution_id) ON DELETE RESTRICT;
ALTER TABLE "provider_terminal_ledger_records" ADD CONSTRAINT "provider_terminal_ledger_records_execution_id_fkey" FOREIGN KEY (execution_id) REFERENCES provider_executions(execution_id) ON DELETE RESTRICT;
ALTER TABLE "provider_terminal_ledger_records" ADD CONSTRAINT "provider_terminal_ledger_records_finalization_id_fkey" FOREIGN KEY (finalization_id) REFERENCES provider_execution_finalizations(finalization_id) ON DELETE RESTRICT;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_campaign_id_campaigns_id_fk" FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_org_id_organizations_id_fk" FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_org_id_organizations_id_fk" FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
CREATE INDEX ai_stories_campaign_idx ON public.ai_stories USING btree (campaign_id);
CREATE INDEX ai_stories_workspace_idx ON public.ai_stories USING btree (workspace_id, status);
CREATE INDEX ai_story_animation_packages_status_idx ON public.ai_story_animation_packages USING btree (status);
CREATE INDEX ai_story_animation_packages_story_idx ON public.ai_story_animation_packages USING btree (story_id, created_at DESC);
CREATE INDEX ai_story_animation_packages_workspace_idx ON public.ai_story_animation_packages USING btree (workspace_id, created_at DESC);
CREATE INDEX ai_story_animation_packages_workspace_status_idx ON public.ai_story_animation_packages USING btree (workspace_id, status);
CREATE INDEX ai_story_assembly_artifacts_content_hash_idx ON public.ai_story_assembly_artifacts USING btree (content_hash);
CREATE INDEX ai_story_assembly_artifacts_plan_idx ON public.ai_story_assembly_artifacts USING btree (execution_plan_id, created_at);
CREATE INDEX ai_story_assembly_artifacts_workspace_idx ON public.ai_story_assembly_artifacts USING btree (workspace_id, created_at);
CREATE INDEX ai_story_assembly_definition_workspace_idx ON public.ai_story_assembly_definitions USING btree (workspace_id, accepted_at);
CREATE UNIQUE INDEX ai_story_assembly_job_facts_accepted_unique ON public.ai_story_assembly_job_facts USING btree (assembly_job_id) WHERE (fact_kind = 'ACCEPTED'::text);
CREATE INDEX ai_story_assembly_job_facts_job_idx ON public.ai_story_assembly_job_facts USING btree (assembly_job_id, recorded_at);
CREATE INDEX ai_story_assembly_job_facts_plan_idx ON public.ai_story_assembly_job_facts USING btree (execution_plan_id, recorded_at);
CREATE UNIQUE INDEX ai_story_assembly_job_facts_terminal_unique ON public.ai_story_assembly_job_facts USING btree (assembly_job_id) WHERE (fact_kind = ANY (ARRAY['SUCCEEDED'::text, 'FAILED'::text]));
CREATE INDEX ai_story_assembly_job_facts_workspace_idx ON public.ai_story_assembly_job_facts USING btree (workspace_id, recorded_at);
CREATE INDEX ai_story_assembly_jobs_definition_idx ON public.ai_story_assembly_jobs USING btree (assembly_definition_id);
CREATE INDEX ai_story_assembly_jobs_plan_idx ON public.ai_story_assembly_jobs USING btree (execution_plan_id, accepted_at);
CREATE INDEX ai_story_assembly_jobs_workspace_idx ON public.ai_story_assembly_jobs USING btree (workspace_id, accepted_at);
CREATE INDEX ai_story_assembly_membership_def_idx ON public.ai_story_assembly_scene_memberships USING btree (assembly_definition_id, scene_order);
CREATE INDEX ai_story_assembly_membership_plan_idx ON public.ai_story_assembly_scene_memberships USING btree (execution_plan_id, scene_order);
CREATE INDEX ai_story_assembly_membership_workspace_idx ON public.ai_story_assembly_scene_memberships USING btree (workspace_id, accepted_at);
CREATE INDEX ai_story_asset_links_asset_idx ON public.ai_story_asset_links USING btree (asset_id);
CREATE INDEX ai_story_creative_contexts_story_idx ON public.ai_story_creative_contexts USING btree (story_id, created_at DESC);
CREATE INDEX ai_story_creative_contexts_workspace_idx ON public.ai_story_creative_contexts USING btree (workspace_id, created_at DESC);
CREATE INDEX ai_story_durable_scene_media_hash_idx ON public.ai_story_durable_scene_media_attestations USING btree (content_hash);
CREATE INDEX ai_story_durable_scene_media_plan_idx ON public.ai_story_durable_scene_media_attestations USING btree (execution_plan_id, accepted_at);
CREATE INDEX ai_story_durable_scene_media_workspace_idx ON public.ai_story_durable_scene_media_attestations USING btree (workspace_id, accepted_at);
CREATE INDEX ai_story_execute_verification_workspace_idx ON public.ai_story_execute_verifications USING btree (workspace_id, created_at);
CREATE INDEX ai_story_execution_jobs_status_idx ON public.ai_story_execution_jobs USING btree (status, created_at DESC);
CREATE INDEX ai_story_execution_jobs_story_idx ON public.ai_story_execution_jobs USING btree (story_id, created_at DESC);
CREATE INDEX ai_story_execution_jobs_workspace_idx ON public.ai_story_execution_jobs USING btree (workspace_id, status);
CREATE INDEX ai_story_execution_outputs_job_idx ON public.ai_story_execution_outputs USING btree (execution_job_id, output_index);
CREATE INDEX ai_story_execution_outputs_workspace_idx ON public.ai_story_execution_outputs USING btree (workspace_id, status);
CREATE INDEX ai_story_execution_plans_story_idx ON public.ai_story_execution_plans USING btree (story_id, created_at);
CREATE INDEX ai_story_execution_plans_story_version_idx ON public.ai_story_execution_plans USING btree (workspace_id, story_version_id, created_at);
CREATE INDEX ai_story_execution_plans_workspace_idx ON public.ai_story_execution_plans USING btree (workspace_id, created_at);
CREATE INDEX ai_story_final_story_results_content_hash_idx ON public.ai_story_final_story_results USING btree (content_hash);
CREATE INDEX ai_story_final_story_results_plan_idx ON public.ai_story_final_story_results USING btree (execution_plan_id, accepted_at);
CREATE INDEX ai_story_final_story_results_workspace_idx ON public.ai_story_final_story_results USING btree (workspace_id, accepted_at);
CREATE UNIQUE INDEX ai_story_generated_scene_reviews_approved_scene_unique ON public.ai_story_generated_scene_reviews USING btree (scene_execution_id) WHERE (decision = 'APPROVED'::text);
CREATE INDEX ai_story_generated_scene_reviews_plan_idx ON public.ai_story_generated_scene_reviews USING btree (execution_plan_id, created_at);
CREATE INDEX ai_story_generated_scene_reviews_workspace_idx ON public.ai_story_generated_scene_reviews USING btree (workspace_id, created_at);
CREATE INDEX ai_story_review_opened_workspace_idx ON public.ai_story_review_opened_facts USING btree (workspace_id, accepted_at);
CREATE INDEX ai_story_runtime_auth_workspace_idx ON public.ai_story_runtime_authorized_facts USING btree (workspace_id, accepted_at);
CREATE INDEX ai_story_scene_attempt_input_revision_workspace_idx ON public.ai_story_scene_attempt_input_revisions USING btree (workspace_id, accepted_at);
CREATE INDEX ai_story_scene_executions_plan_idx ON public.ai_story_scene_executions USING btree (execution_plan_id, scene_order);
CREATE INDEX ai_story_instruction_snapshots_id_idx ON public.ai_story_scene_instruction_snapshots USING btree (snapshot_id);
CREATE INDEX ai_story_instruction_snapshots_workspace_idx ON public.ai_story_scene_instruction_snapshots USING btree (workspace_id, created_at);
CREATE INDEX ai_story_scene_intent_review_plan_idx ON public.ai_story_scene_intent_review_facts USING btree (execution_plan_id, accepted_at);
CREATE INDEX ai_story_scene_intent_review_scene_idx ON public.ai_story_scene_intent_review_facts USING btree (scene_execution_id, accepted_at);
CREATE INDEX ai_story_scene_intent_review_workspace_idx ON public.ai_story_scene_intent_review_facts USING btree (workspace_id, accepted_at);
CREATE INDEX ai_story_scene_validation_plan_idx ON public.ai_story_scene_intent_validation_results USING btree (execution_plan_id, accepted_at);
CREATE INDEX ai_story_scene_validation_scene_idx ON public.ai_story_scene_intent_validation_results USING btree (scene_execution_id, accepted_at);
CREATE INDEX ai_story_scene_validation_workspace_idx ON public.ai_story_scene_intent_validation_results USING btree (workspace_id, accepted_at);
CREATE UNIQUE INDEX ai_story_scene_projection_scene_attempt_unique ON public.ai_story_scene_projection_correlations USING btree (scene_execution_id, provider_attempt_id);
CREATE INDEX ai_story_scene_projection_workspace_idx ON public.ai_story_scene_projection_correlations USING btree (workspace_id, projected_at);
CREATE INDEX ai_story_scene_release_plan_idx ON public.ai_story_scene_release_states USING btree (execution_plan_id, scene_order);
CREATE INDEX ai_story_scene_release_workspace_idx ON public.ai_story_scene_release_states USING btree (workspace_id, created_at);
CREATE INDEX ai_story_scene_results_plan_idx ON public.ai_story_scene_results USING btree (execution_plan_id, scene_order);
CREATE UNIQUE INDEX ai_story_scene_results_scene_attempt_unique ON public.ai_story_scene_results USING btree (scene_execution_id, provider_attempt_id);
CREATE INDEX ai_story_scene_results_workspace_idx ON public.ai_story_scene_results USING btree (workspace_id, projected_at);
CREATE INDEX ai_story_scene_retry_authorization_workspace_idx ON public.ai_story_scene_retry_authorizations USING btree (workspace_id, created_at);
CREATE INDEX ai_story_scene_retry_eligibility_scene_idx ON public.ai_story_scene_retry_eligibility_facts USING btree (scene_execution_id, created_at);
CREATE INDEX ai_story_scene_retry_eligibility_workspace_idx ON public.ai_story_scene_retry_eligibility_facts USING btree (workspace_id, created_at);
CREATE INDEX ai_story_scene_routing_auth_idx ON public.ai_story_scene_routing_decisions USING btree (runtime_authorization_id);
CREATE INDEX ai_story_scene_routing_plan_idx ON public.ai_story_scene_routing_decisions USING btree (execution_plan_id, accepted_at);
CREATE INDEX ai_story_scene_routing_workspace_idx ON public.ai_story_scene_routing_decisions USING btree (workspace_id, accepted_at);
CREATE INDEX ai_story_scene_scheduling_auth_idx ON public.ai_story_scene_scheduling_correlations USING btree (runtime_authorization_id);
CREATE INDEX ai_story_scene_scheduling_plan_idx ON public.ai_story_scene_scheduling_correlations USING btree (execution_plan_id, accepted_at);
CREATE INDEX ai_story_scene_scheduling_scene_idx ON public.ai_story_scene_scheduling_correlations USING btree (scene_execution_id, accepted_at);
CREATE INDEX ai_story_scene_scheduling_workspace_idx ON public.ai_story_scene_scheduling_correlations USING btree (workspace_id, accepted_at);
CREATE INDEX ai_story_story_review_plan_idx ON public.ai_story_story_review_facts USING btree (execution_plan_id, accepted_at);
CREATE INDEX ai_story_story_review_workspace_idx ON public.ai_story_story_review_facts USING btree (workspace_id, accepted_at);
CREATE INDEX ai_story_versions_story_idx ON public.ai_story_versions USING btree (story_id, version_number DESC);
CREATE INDEX ai_story_worker_observation_attempt_idx ON public.ai_story_worker_attempt_observations USING btree (provider_attempt_id, produced_at DESC);
CREATE INDEX ai_story_worker_observation_dispatch_idx ON public.ai_story_worker_attempt_observations USING btree (dispatch_id, produced_at DESC);
CREATE INDEX ai_story_worker_observation_workspace_idx ON public.ai_story_worker_attempt_observations USING btree (workspace_id, accepted_at);
CREATE INDEX ai_story_worker_result_execution_idx ON public.ai_story_worker_execution_results USING btree (provider_execution_id);
CREATE INDEX ai_story_worker_result_workspace_idx ON public.ai_story_worker_execution_results USING btree (workspace_id, accepted_at);
CREATE INDEX assets_campaign_idx ON public.assets USING btree (campaign_id);
CREATE INDEX assets_workspace_content_hash_idx ON public.assets USING btree (workspace_id, content_hash);
CREATE INDEX assets_workspace_deleted_idx ON public.assets USING btree (workspace_id, deleted_at);
CREATE INDEX assets_workspace_idx ON public.assets USING btree (workspace_id);
CREATE INDEX business_profiles_workspace_idx ON public.business_profiles USING btree (workspace_id);
CREATE INDEX campaigns_business_status_idx ON public.campaigns USING btree (workspace_id, business_status);
CREATE INDEX campaigns_deleted_at_idx ON public.campaigns USING btree (workspace_id, deleted_at);
CREATE UNIQUE INDEX campaigns_workspace_creation_idempotency_idx ON public.campaigns USING btree (workspace_id, creation_idempotency_key) WHERE (creation_idempotency_key IS NOT NULL);
CREATE INDEX campaigns_workspace_idx ON public.campaigns USING btree (workspace_id);
CREATE INDEX commercial_execution_authorizations_execution_idx ON public.commercial_execution_authorizations USING btree (execution_identity);
CREATE INDEX commercial_execution_authorizations_org_idx ON public.commercial_execution_authorizations USING btree (org_id, authorized_at DESC);
CREATE INDEX commercial_execution_authorizations_workspace_idx ON public.commercial_execution_authorizations USING btree (workspace_id, authorized_at DESC);
CREATE INDEX creatives_campaign_idx ON public.creatives USING btree (campaign_id);
CREATE UNIQUE INDEX credit_reservations_execution_uidx ON public.credit_reservations USING btree (credit_wallet_id, execution_identity) WHERE (execution_identity IS NOT NULL);
CREATE INDEX credit_reservations_org_idx ON public.credit_reservations USING btree (org_id, created_at DESC);
CREATE INDEX credit_reservations_status_idx ON public.credit_reservations USING btree (credit_wallet_id, status);
CREATE INDEX credit_wallets_org_idx ON public.credit_wallets USING btree (org_id);
CREATE INDEX marketing_packages_workspace_idx ON public.marketing_packages USING btree (workspace_id);
CREATE INDEX photo_scene_generations_campaign_idx ON public.photo_scene_generations USING btree (campaign_id, created_at);
CREATE UNIQUE INDEX photo_scene_generations_inflight_fingerprint_idx ON public.photo_scene_generations USING btree (workspace_id, operation, input_fingerprint) WHERE (status = ANY (ARRAY['queued'::text, 'processing'::text]));
CREATE INDEX photo_scene_generations_reuse_idx ON public.photo_scene_generations USING btree (workspace_id, operation, input_fingerprint, status);
CREATE INDEX photo_scene_generations_workspace_idx ON public.photo_scene_generations USING btree (workspace_id, created_at);
CREATE INDEX provider_attempts_execution_idx ON public.provider_attempts USING btree (execution_id, attempt_number);
CREATE INDEX provider_execution_dispatches_execution_idx ON public.provider_execution_dispatches USING btree (execution_id);
CREATE INDEX provider_execution_dispatches_workspace_idx ON public.provider_execution_dispatches USING btree (workspace_id, created_at);
CREATE INDEX provider_execution_envelopes_request_hash_idx ON public.provider_execution_envelopes USING btree (request_hash);
CREATE INDEX provider_execution_envelopes_workspace_idx ON public.provider_execution_envelopes USING btree (workspace_id, created_at);
CREATE INDEX provider_execution_finalizations_workspace_idx ON public.provider_execution_finalizations USING btree (workspace_id, accepted_at);
CREATE INDEX provider_executions_fingerprint_idx ON public.provider_executions USING btree (deterministic_fingerprint);
CREATE INDEX provider_executions_workspace_idx ON public.provider_executions USING btree (workspace_id, created_at);
CREATE INDEX provider_outbox_jobs_claim_idx ON public.provider_outbox_jobs USING btree (status, next_visible_at, priority);
CREATE INDEX provider_outbox_jobs_lease_idx ON public.provider_outbox_jobs USING btree (status, lease_expires_at);
CREATE INDEX tasks_campaign_idx ON public.tasks USING btree (campaign_id);
CREATE OR REPLACE FUNCTION public.reject_ai_story_attempt_input_revision_mutation() RETURNS trigger LANGUAGE plpgsql AS $function$ BEGIN RAISE EXCEPTION 'AI_STORY_ATTEMPT_INPUT_REVISION_IMMUTABLE'; END $function$;
CREATE TRIGGER ai_story_attempt_input_revision_immutable BEFORE UPDATE ON ai_story_scene_attempt_input_revisions FOR EACH ROW EXECUTE FUNCTION reject_ai_story_attempt_input_revision_mutation();
ALTER TABLE "ai_story_assembly_artifacts" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_story_assembly_artifacts_select" ON "ai_story_assembly_artifacts" AS PERMISSIVE FOR SELECT TO PUBLIC USING ((workspace_id IN ( SELECT user_workspace_ids() AS user_workspace_ids)));
ALTER TABLE "ai_story_assembly_definitions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_story_assembly_definitions_insert" ON "ai_story_assembly_definitions" AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK (((workspace_id IN ( SELECT user_workspace_ids() AS user_workspace_ids)) AND (org_id = ( SELECT workspaces.org_id
   FROM workspaces
  WHERE (workspaces.id = ai_story_assembly_definitions.workspace_id))) AND (EXISTS ( SELECT 1
   FROM ai_story_execution_plans plan
  WHERE ((plan.id = ai_story_assembly_definitions.execution_plan_id) AND (plan.org_id = ai_story_assembly_definitions.org_id) AND (plan.workspace_id = ai_story_assembly_definitions.workspace_id) AND (plan.campaign_id = ai_story_assembly_definitions.campaign_id) AND (plan.story_id = ai_story_assembly_definitions.story_id) AND (plan.story_version_id = ai_story_assembly_definitions.story_version_id) AND (plan.animation_package_id = ai_story_assembly_definitions.animation_package_id)))) AND (EXISTS ( SELECT 1
   FROM campaigns campaign
  WHERE ((campaign.id = ai_story_assembly_definitions.campaign_id) AND (campaign.workspace_id = ai_story_assembly_definitions.workspace_id) AND (campaign.org_id = ai_story_assembly_definitions.org_id)))) AND (EXISTS ( SELECT 1
   FROM ai_stories story
  WHERE ((story.id = ai_story_assembly_definitions.story_id) AND (story.campaign_id = ai_story_assembly_definitions.campaign_id) AND (story.workspace_id = ai_story_assembly_definitions.workspace_id) AND (story.org_id = ai_story_assembly_definitions.org_id)))) AND (EXISTS ( SELECT 1
   FROM ai_story_versions version
  WHERE ((version.id = ai_story_assembly_definitions.story_version_id) AND (version.story_id = ai_story_assembly_definitions.story_id)))) AND (EXISTS ( SELECT 1
   FROM ai_story_animation_packages package
  WHERE ((package.id = ai_story_assembly_definitions.animation_package_id) AND (package.story_id = ai_story_assembly_definitions.story_id) AND (package.story_version_id = ai_story_assembly_definitions.story_version_id) AND (package.campaign_id = ai_story_assembly_definitions.campaign_id) AND (package.workspace_id = ai_story_assembly_definitions.workspace_id) AND (package.org_id = ai_story_assembly_definitions.org_id))))));
CREATE POLICY "ai_story_assembly_definitions_select" ON "ai_story_assembly_definitions" AS PERMISSIVE FOR SELECT TO PUBLIC USING (((workspace_id IN ( SELECT user_workspace_ids() AS user_workspace_ids)) AND (org_id = ( SELECT workspaces.org_id
   FROM workspaces
  WHERE (workspaces.id = ai_story_assembly_definitions.workspace_id)))));
ALTER TABLE "ai_story_assembly_job_facts" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_story_assembly_job_facts_select" ON "ai_story_assembly_job_facts" AS PERMISSIVE FOR SELECT TO PUBLIC USING ((workspace_id IN ( SELECT user_workspace_ids() AS user_workspace_ids)));
ALTER TABLE "ai_story_assembly_jobs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_story_assembly_jobs_select" ON "ai_story_assembly_jobs" AS PERMISSIVE FOR SELECT TO PUBLIC USING ((workspace_id IN ( SELECT user_workspace_ids() AS user_workspace_ids)));
ALTER TABLE "ai_story_assembly_scene_memberships" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_story_assembly_memberships_insert" ON "ai_story_assembly_scene_memberships" AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK (((workspace_id IN ( SELECT user_workspace_ids() AS user_workspace_ids)) AND (org_id = ( SELECT workspaces.org_id
   FROM workspaces
  WHERE (workspaces.id = ai_story_assembly_scene_memberships.workspace_id))) AND (EXISTS ( SELECT 1
   FROM ai_story_assembly_definitions definition
  WHERE ((definition.assembly_definition_id = ai_story_assembly_scene_memberships.assembly_definition_id) AND (definition.org_id = ai_story_assembly_scene_memberships.org_id) AND (definition.workspace_id = ai_story_assembly_scene_memberships.workspace_id) AND (definition.campaign_id = ai_story_assembly_scene_memberships.campaign_id) AND (definition.story_id = ai_story_assembly_scene_memberships.story_id) AND (definition.story_version_id = ai_story_assembly_scene_memberships.story_version_id) AND (definition.animation_package_id = ai_story_assembly_scene_memberships.animation_package_id) AND (definition.execution_plan_id = ai_story_assembly_scene_memberships.execution_plan_id)))) AND (EXISTS ( SELECT 1
   FROM ai_story_scene_executions scene
  WHERE ((scene.id = ai_story_assembly_scene_memberships.scene_execution_id) AND (scene.execution_plan_id = ai_story_assembly_scene_memberships.execution_plan_id) AND (scene.org_id = ai_story_assembly_scene_memberships.org_id) AND (scene.workspace_id = ai_story_assembly_scene_memberships.workspace_id) AND (scene.campaign_id = ai_story_assembly_scene_memberships.campaign_id) AND (scene.story_id = ai_story_assembly_scene_memberships.story_id) AND (scene.story_version_id = ai_story_assembly_scene_memberships.story_version_id) AND (scene.animation_package_id = ai_story_assembly_scene_memberships.animation_package_id)))) AND (EXISTS ( SELECT 1
   FROM ai_story_execution_plans plan
  WHERE ((plan.id = ai_story_assembly_scene_memberships.execution_plan_id) AND (plan.org_id = ai_story_assembly_scene_memberships.org_id) AND (plan.workspace_id = ai_story_assembly_scene_memberships.workspace_id) AND (plan.campaign_id = ai_story_assembly_scene_memberships.campaign_id) AND (plan.story_id = ai_story_assembly_scene_memberships.story_id) AND (plan.story_version_id = ai_story_assembly_scene_memberships.story_version_id) AND (plan.animation_package_id = ai_story_assembly_scene_memberships.animation_package_id))))));
CREATE POLICY "ai_story_assembly_memberships_select" ON "ai_story_assembly_scene_memberships" AS PERMISSIVE FOR SELECT TO PUBLIC USING (((workspace_id IN ( SELECT user_workspace_ids() AS user_workspace_ids)) AND (org_id = ( SELECT workspaces.org_id
   FROM workspaces
  WHERE (workspaces.id = ai_story_assembly_scene_memberships.workspace_id)))));
ALTER TABLE "ai_story_execute_verifications" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_story_execute_verifications_select" ON "ai_story_execute_verifications" AS PERMISSIVE FOR SELECT TO PUBLIC USING ((workspace_id IN ( SELECT user_workspace_ids() AS user_workspace_ids)));
ALTER TABLE "ai_story_execution_plans" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_story_execution_plans_insert" ON "ai_story_execution_plans" AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK (((workspace_id IN ( SELECT user_workspace_ids() AS user_workspace_ids)) AND (org_id = ( SELECT workspaces.org_id
   FROM workspaces
  WHERE (workspaces.id = ai_story_execution_plans.workspace_id))) AND (EXISTS ( SELECT 1
   FROM campaigns campaign
  WHERE ((campaign.id = ai_story_execution_plans.campaign_id) AND (campaign.workspace_id = ai_story_execution_plans.workspace_id) AND (campaign.org_id = ai_story_execution_plans.org_id)))) AND (EXISTS ( SELECT 1
   FROM ai_stories story
  WHERE ((story.id = ai_story_execution_plans.story_id) AND (story.campaign_id = ai_story_execution_plans.campaign_id) AND (story.workspace_id = ai_story_execution_plans.workspace_id) AND (story.org_id = ai_story_execution_plans.org_id)))) AND (EXISTS ( SELECT 1
   FROM ai_story_versions version
  WHERE ((version.id = ai_story_execution_plans.story_version_id) AND (version.story_id = ai_story_execution_plans.story_id)))) AND (EXISTS ( SELECT 1
   FROM ai_story_animation_packages package
  WHERE ((package.id = ai_story_execution_plans.animation_package_id) AND (package.story_id = ai_story_execution_plans.story_id) AND (package.story_version_id = ai_story_execution_plans.story_version_id) AND (package.campaign_id = ai_story_execution_plans.campaign_id) AND (package.workspace_id = ai_story_execution_plans.workspace_id) AND (package.org_id = ai_story_execution_plans.org_id))))));
CREATE POLICY "ai_story_execution_plans_select" ON "ai_story_execution_plans" AS PERMISSIVE FOR SELECT TO PUBLIC USING (((workspace_id IN ( SELECT user_workspace_ids() AS user_workspace_ids)) AND (org_id = ( SELECT workspaces.org_id
   FROM workspaces
  WHERE (workspaces.id = ai_story_execution_plans.workspace_id)))));
ALTER TABLE "ai_story_final_story_results" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_story_final_story_results_select" ON "ai_story_final_story_results" AS PERMISSIVE FOR SELECT TO PUBLIC USING ((workspace_id IN ( SELECT user_workspace_ids() AS user_workspace_ids)));
ALTER TABLE "ai_story_generated_scene_reviews" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_story_generated_scene_reviews_select" ON "ai_story_generated_scene_reviews" AS PERMISSIVE FOR SELECT TO PUBLIC USING ((workspace_id IN ( SELECT user_workspace_ids() AS user_workspace_ids)));
ALTER TABLE "ai_story_review_opened_facts" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_story_review_opened_insert" ON "ai_story_review_opened_facts" AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK (((workspace_id IN ( SELECT user_workspace_ids() AS user_workspace_ids)) AND (org_id = ( SELECT workspaces.org_id
   FROM workspaces
  WHERE (workspaces.id = ai_story_review_opened_facts.workspace_id))) AND (EXISTS ( SELECT 1
   FROM ai_story_execution_plans plan
  WHERE ((plan.id = ai_story_review_opened_facts.execution_plan_id) AND (plan.org_id = ai_story_review_opened_facts.org_id) AND (plan.workspace_id = ai_story_review_opened_facts.workspace_id) AND (plan.campaign_id = ai_story_review_opened_facts.campaign_id) AND (plan.story_id = ai_story_review_opened_facts.story_id) AND (plan.story_version_id = ai_story_review_opened_facts.story_version_id) AND (plan.animation_package_id = ai_story_review_opened_facts.animation_package_id)))) AND (EXISTS ( SELECT 1
   FROM campaigns campaign
  WHERE ((campaign.id = ai_story_review_opened_facts.campaign_id) AND (campaign.workspace_id = ai_story_review_opened_facts.workspace_id) AND (campaign.org_id = ai_story_review_opened_facts.org_id)))) AND (EXISTS ( SELECT 1
   FROM ai_stories story
  WHERE ((story.id = ai_story_review_opened_facts.story_id) AND (story.campaign_id = ai_story_review_opened_facts.campaign_id) AND (story.workspace_id = ai_story_review_opened_facts.workspace_id) AND (story.org_id = ai_story_review_opened_facts.org_id)))) AND (EXISTS ( SELECT 1
   FROM ai_story_versions version
  WHERE ((version.id = ai_story_review_opened_facts.story_version_id) AND (version.story_id = ai_story_review_opened_facts.story_id)))) AND (EXISTS ( SELECT 1
   FROM ai_story_animation_packages package
  WHERE ((package.id = ai_story_review_opened_facts.animation_package_id) AND (package.story_id = ai_story_review_opened_facts.story_id) AND (package.story_version_id = ai_story_review_opened_facts.story_version_id) AND (package.campaign_id = ai_story_review_opened_facts.campaign_id) AND (package.workspace_id = ai_story_review_opened_facts.workspace_id) AND (package.org_id = ai_story_review_opened_facts.org_id))))));
CREATE POLICY "ai_story_review_opened_select" ON "ai_story_review_opened_facts" AS PERMISSIVE FOR SELECT TO PUBLIC USING (((workspace_id IN ( SELECT user_workspace_ids() AS user_workspace_ids)) AND (org_id = ( SELECT workspaces.org_id
   FROM workspaces
  WHERE (workspaces.id = ai_story_review_opened_facts.workspace_id)))));
ALTER TABLE "ai_story_runtime_authorized_facts" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_story_runtime_auth_insert" ON "ai_story_runtime_authorized_facts" AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK (((workspace_id IN ( SELECT user_workspace_ids() AS user_workspace_ids)) AND (org_id = ( SELECT workspaces.org_id
   FROM workspaces
  WHERE (workspaces.id = ai_story_runtime_authorized_facts.workspace_id))) AND (EXISTS ( SELECT 1
   FROM ai_story_execution_plans plan
  WHERE ((plan.id = ai_story_runtime_authorized_facts.execution_plan_id) AND (plan.org_id = ai_story_runtime_authorized_facts.org_id) AND (plan.workspace_id = ai_story_runtime_authorized_facts.workspace_id) AND (plan.campaign_id = ai_story_runtime_authorized_facts.campaign_id) AND (plan.story_id = ai_story_runtime_authorized_facts.story_id) AND (plan.story_version_id = ai_story_runtime_authorized_facts.story_version_id) AND (plan.animation_package_id = ai_story_runtime_authorized_facts.animation_package_id))))));
CREATE POLICY "ai_story_runtime_auth_select" ON "ai_story_runtime_authorized_facts" AS PERMISSIVE FOR SELECT TO PUBLIC USING (((workspace_id IN ( SELECT user_workspace_ids() AS user_workspace_ids)) AND (org_id = ( SELECT workspaces.org_id
   FROM workspaces
  WHERE (workspaces.id = ai_story_runtime_authorized_facts.workspace_id))) AND (EXISTS ( SELECT 1
   FROM ai_story_execution_plans plan
  WHERE ((plan.id = ai_story_runtime_authorized_facts.execution_plan_id) AND (plan.org_id = ai_story_runtime_authorized_facts.org_id) AND (plan.workspace_id = ai_story_runtime_authorized_facts.workspace_id) AND (plan.campaign_id = ai_story_runtime_authorized_facts.campaign_id) AND (plan.story_id = ai_story_runtime_authorized_facts.story_id) AND (plan.story_version_id = ai_story_runtime_authorized_facts.story_version_id) AND (plan.animation_package_id = ai_story_runtime_authorized_facts.animation_package_id))))));
ALTER TABLE "ai_story_scene_attempt_input_revisions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_story_scene_attempt_input_revision_service_role" ON "ai_story_scene_attempt_input_revisions" AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
ALTER TABLE "ai_story_scene_executions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_story_scene_executions_insert" ON "ai_story_scene_executions" AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK (((workspace_id IN ( SELECT user_workspace_ids() AS user_workspace_ids)) AND (org_id = ( SELECT workspaces.org_id
   FROM workspaces
  WHERE (workspaces.id = ai_story_scene_executions.workspace_id))) AND (EXISTS ( SELECT 1
   FROM ai_story_execution_plans plan
  WHERE ((plan.id = ai_story_scene_executions.execution_plan_id) AND (plan.org_id = ai_story_scene_executions.org_id) AND (plan.workspace_id = ai_story_scene_executions.workspace_id) AND (plan.campaign_id = ai_story_scene_executions.campaign_id) AND (plan.story_id = ai_story_scene_executions.story_id) AND (plan.story_version_id = ai_story_scene_executions.story_version_id) AND (plan.animation_package_id = ai_story_scene_executions.animation_package_id)))) AND (EXISTS ( SELECT 1
   FROM campaigns campaign
  WHERE ((campaign.id = ai_story_scene_executions.campaign_id) AND (campaign.workspace_id = ai_story_scene_executions.workspace_id) AND (campaign.org_id = ai_story_scene_executions.org_id)))) AND (EXISTS ( SELECT 1
   FROM ai_stories story
  WHERE ((story.id = ai_story_scene_executions.story_id) AND (story.campaign_id = ai_story_scene_executions.campaign_id) AND (story.workspace_id = ai_story_scene_executions.workspace_id) AND (story.org_id = ai_story_scene_executions.org_id)))) AND (EXISTS ( SELECT 1
   FROM ai_story_versions version
  WHERE ((version.id = ai_story_scene_executions.story_version_id) AND (version.story_id = ai_story_scene_executions.story_id)))) AND (EXISTS ( SELECT 1
   FROM ai_story_animation_packages package
  WHERE ((package.id = ai_story_scene_executions.animation_package_id) AND (package.story_id = ai_story_scene_executions.story_id) AND (package.story_version_id = ai_story_scene_executions.story_version_id) AND (package.campaign_id = ai_story_scene_executions.campaign_id) AND (package.workspace_id = ai_story_scene_executions.workspace_id) AND (package.org_id = ai_story_scene_executions.org_id))))));
CREATE POLICY "ai_story_scene_executions_select" ON "ai_story_scene_executions" AS PERMISSIVE FOR SELECT TO PUBLIC USING (((workspace_id IN ( SELECT user_workspace_ids() AS user_workspace_ids)) AND (org_id = ( SELECT workspaces.org_id
   FROM workspaces
  WHERE (workspaces.id = ai_story_scene_executions.workspace_id)))));
ALTER TABLE "ai_story_scene_instruction_snapshots" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_story_instruction_snapshots_select" ON "ai_story_scene_instruction_snapshots" AS PERMISSIVE FOR SELECT TO PUBLIC USING ((EXISTS ( SELECT 1
   FROM (ai_story_scene_executions scene
     JOIN ai_story_execution_plans plan ON ((plan.id = scene.execution_plan_id)))
  WHERE ((scene.instruction_hash = ai_story_scene_instruction_snapshots.content_hash) AND (scene.org_id = ai_story_scene_instruction_snapshots.org_id) AND (scene.workspace_id = ai_story_scene_instruction_snapshots.workspace_id) AND (plan.org_id = scene.org_id) AND (plan.workspace_id = scene.workspace_id) AND (plan.campaign_id = scene.campaign_id) AND (plan.story_id = scene.story_id) AND (plan.story_version_id = scene.story_version_id) AND (plan.animation_package_id = scene.animation_package_id) AND (scene.workspace_id IN ( SELECT user_workspace_ids() AS user_workspace_ids)) AND (scene.org_id = ( SELECT workspaces.org_id
           FROM workspaces
          WHERE (workspaces.id = scene.workspace_id))) AND (EXISTS ( SELECT 1
           FROM campaigns campaign
          WHERE ((campaign.id = plan.campaign_id) AND (campaign.workspace_id = plan.workspace_id) AND (campaign.org_id = plan.org_id)))) AND (EXISTS ( SELECT 1
           FROM ai_stories story
          WHERE ((story.id = plan.story_id) AND (story.campaign_id = plan.campaign_id) AND (story.workspace_id = plan.workspace_id) AND (story.org_id = plan.org_id)))) AND (EXISTS ( SELECT 1
           FROM ai_story_versions version
          WHERE ((version.id = plan.story_version_id) AND (version.story_id = plan.story_id)))) AND (EXISTS ( SELECT 1
           FROM ai_story_animation_packages package
          WHERE ((package.id = plan.animation_package_id) AND (package.story_id = plan.story_id) AND (package.story_version_id = plan.story_version_id) AND (package.campaign_id = plan.campaign_id) AND (package.workspace_id = plan.workspace_id) AND (package.org_id = plan.org_id))))))));
ALTER TABLE "ai_story_scene_intent_review_facts" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_story_scene_intent_review_insert" ON "ai_story_scene_intent_review_facts" AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK (((workspace_id IN ( SELECT user_workspace_ids() AS user_workspace_ids)) AND (org_id = ( SELECT workspaces.org_id
   FROM workspaces
  WHERE (workspaces.id = ai_story_scene_intent_review_facts.workspace_id))) AND (EXISTS ( SELECT 1
   FROM ai_story_execution_plans plan
  WHERE ((plan.id = ai_story_scene_intent_review_facts.execution_plan_id) AND (plan.org_id = ai_story_scene_intent_review_facts.org_id) AND (plan.workspace_id = ai_story_scene_intent_review_facts.workspace_id) AND (plan.campaign_id = ai_story_scene_intent_review_facts.campaign_id) AND (plan.story_id = ai_story_scene_intent_review_facts.story_id) AND (plan.story_version_id = ai_story_scene_intent_review_facts.story_version_id) AND (plan.animation_package_id = ai_story_scene_intent_review_facts.animation_package_id)))) AND (EXISTS ( SELECT 1
   FROM ai_story_scene_executions scene
  WHERE ((scene.id = ai_story_scene_intent_review_facts.scene_execution_id) AND (scene.execution_plan_id = ai_story_scene_intent_review_facts.execution_plan_id) AND (scene.org_id = ai_story_scene_intent_review_facts.org_id) AND (scene.workspace_id = ai_story_scene_intent_review_facts.workspace_id) AND (scene.campaign_id = ai_story_scene_intent_review_facts.campaign_id) AND (scene.story_id = ai_story_scene_intent_review_facts.story_id) AND (scene.story_version_id = ai_story_scene_intent_review_facts.story_version_id) AND (scene.animation_package_id = ai_story_scene_intent_review_facts.animation_package_id)))) AND (EXISTS ( SELECT 1
   FROM campaigns campaign
  WHERE ((campaign.id = ai_story_scene_intent_review_facts.campaign_id) AND (campaign.workspace_id = ai_story_scene_intent_review_facts.workspace_id) AND (campaign.org_id = ai_story_scene_intent_review_facts.org_id)))) AND (EXISTS ( SELECT 1
   FROM ai_stories story
  WHERE ((story.id = ai_story_scene_intent_review_facts.story_id) AND (story.campaign_id = ai_story_scene_intent_review_facts.campaign_id) AND (story.workspace_id = ai_story_scene_intent_review_facts.workspace_id) AND (story.org_id = ai_story_scene_intent_review_facts.org_id)))) AND (EXISTS ( SELECT 1
   FROM ai_story_versions version
  WHERE ((version.id = ai_story_scene_intent_review_facts.story_version_id) AND (version.story_id = ai_story_scene_intent_review_facts.story_id)))) AND (EXISTS ( SELECT 1
   FROM ai_story_animation_packages package
  WHERE ((package.id = ai_story_scene_intent_review_facts.animation_package_id) AND (package.story_id = ai_story_scene_intent_review_facts.story_id) AND (package.story_version_id = ai_story_scene_intent_review_facts.story_version_id) AND (package.campaign_id = ai_story_scene_intent_review_facts.campaign_id) AND (package.workspace_id = ai_story_scene_intent_review_facts.workspace_id) AND (package.org_id = ai_story_scene_intent_review_facts.org_id))))));
CREATE POLICY "ai_story_scene_intent_review_select" ON "ai_story_scene_intent_review_facts" AS PERMISSIVE FOR SELECT TO PUBLIC USING (((workspace_id IN ( SELECT user_workspace_ids() AS user_workspace_ids)) AND (org_id = ( SELECT workspaces.org_id
   FROM workspaces
  WHERE (workspaces.id = ai_story_scene_intent_review_facts.workspace_id)))));
ALTER TABLE "ai_story_scene_intent_validation_results" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_story_scene_validation_insert" ON "ai_story_scene_intent_validation_results" AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK (((workspace_id IN ( SELECT user_workspace_ids() AS user_workspace_ids)) AND (org_id = ( SELECT workspaces.org_id
   FROM workspaces
  WHERE (workspaces.id = ai_story_scene_intent_validation_results.workspace_id))) AND (EXISTS ( SELECT 1
   FROM ai_story_execution_plans plan
  WHERE ((plan.id = ai_story_scene_intent_validation_results.execution_plan_id) AND (plan.org_id = ai_story_scene_intent_validation_results.org_id) AND (plan.workspace_id = ai_story_scene_intent_validation_results.workspace_id)))) AND (EXISTS ( SELECT 1
   FROM ai_story_scene_executions scene
  WHERE ((scene.id = ai_story_scene_intent_validation_results.scene_execution_id) AND (scene.execution_plan_id = ai_story_scene_intent_validation_results.execution_plan_id) AND (scene.org_id = ai_story_scene_intent_validation_results.org_id) AND (scene.workspace_id = ai_story_scene_intent_validation_results.workspace_id))))));
CREATE POLICY "ai_story_scene_validation_select" ON "ai_story_scene_intent_validation_results" AS PERMISSIVE FOR SELECT TO PUBLIC USING (((workspace_id IN ( SELECT user_workspace_ids() AS user_workspace_ids)) AND (org_id = ( SELECT workspaces.org_id
   FROM workspaces
  WHERE (workspaces.id = ai_story_scene_intent_validation_results.workspace_id)))));
ALTER TABLE "ai_story_scene_release_states" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_story_scene_release_states_select" ON "ai_story_scene_release_states" AS PERMISSIVE FOR SELECT TO PUBLIC USING ((workspace_id IN ( SELECT user_workspace_ids() AS user_workspace_ids)));
ALTER TABLE "ai_story_scene_retry_authorizations" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_story_scene_retry_authorization_service_role" ON "ai_story_scene_retry_authorizations" AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
ALTER TABLE "ai_story_scene_retry_eligibility_facts" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_story_scene_retry_eligibility_service_role" ON "ai_story_scene_retry_eligibility_facts" AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
ALTER TABLE "ai_story_scene_routing_decisions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_story_scene_routing_insert" ON "ai_story_scene_routing_decisions" AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK (((workspace_id IN ( SELECT user_workspace_ids() AS user_workspace_ids)) AND (org_id = ( SELECT workspaces.org_id
   FROM workspaces
  WHERE (workspaces.id = ai_story_scene_routing_decisions.workspace_id))) AND (automatic_fallback_enabled = false) AND (EXISTS ( SELECT 1
   FROM ai_story_runtime_authorized_facts auth
  WHERE ((auth.runtime_authorization_id = ai_story_scene_routing_decisions.runtime_authorization_id) AND (auth.execution_plan_id = ai_story_scene_routing_decisions.execution_plan_id) AND (auth.org_id = ai_story_scene_routing_decisions.org_id) AND (auth.workspace_id = ai_story_scene_routing_decisions.workspace_id)))) AND (EXISTS ( SELECT 1
   FROM ai_story_scene_executions scene
  WHERE ((scene.id = ai_story_scene_routing_decisions.scene_execution_id) AND (scene.execution_plan_id = ai_story_scene_routing_decisions.execution_plan_id) AND (scene.org_id = ai_story_scene_routing_decisions.org_id) AND (scene.workspace_id = ai_story_scene_routing_decisions.workspace_id))))));
CREATE POLICY "ai_story_scene_routing_select" ON "ai_story_scene_routing_decisions" AS PERMISSIVE FOR SELECT TO PUBLIC USING (((workspace_id IN ( SELECT user_workspace_ids() AS user_workspace_ids)) AND (org_id = ( SELECT workspaces.org_id
   FROM workspaces
  WHERE (workspaces.id = ai_story_scene_routing_decisions.workspace_id))) AND (EXISTS ( SELECT 1
   FROM ai_story_runtime_authorized_facts auth
  WHERE ((auth.runtime_authorization_id = ai_story_scene_routing_decisions.runtime_authorization_id) AND (auth.execution_plan_id = ai_story_scene_routing_decisions.execution_plan_id) AND (auth.org_id = ai_story_scene_routing_decisions.org_id) AND (auth.workspace_id = ai_story_scene_routing_decisions.workspace_id)))) AND (EXISTS ( SELECT 1
   FROM ai_story_scene_executions scene
  WHERE ((scene.id = ai_story_scene_routing_decisions.scene_execution_id) AND (scene.execution_plan_id = ai_story_scene_routing_decisions.execution_plan_id) AND (scene.org_id = ai_story_scene_routing_decisions.org_id) AND (scene.workspace_id = ai_story_scene_routing_decisions.workspace_id))))));
ALTER TABLE "ai_story_scene_scheduling_correlations" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_story_scene_scheduling_insert" ON "ai_story_scene_scheduling_correlations" AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK (((workspace_id IN ( SELECT user_workspace_ids() AS user_workspace_ids)) AND (org_id = ( SELECT workspaces.org_id
   FROM workspaces
  WHERE (workspaces.id = ai_story_scene_scheduling_correlations.workspace_id))) AND (EXISTS ( SELECT 1
   FROM ai_story_scene_routing_decisions decision
  WHERE ((decision.routing_decision_id = ai_story_scene_scheduling_correlations.routing_decision_id) AND (decision.scene_execution_id = ai_story_scene_scheduling_correlations.scene_execution_id) AND (decision.execution_plan_id = ai_story_scene_scheduling_correlations.execution_plan_id) AND (decision.runtime_authorization_id = ai_story_scene_scheduling_correlations.runtime_authorization_id) AND (decision.org_id = ai_story_scene_scheduling_correlations.org_id) AND (decision.workspace_id = ai_story_scene_scheduling_correlations.workspace_id)))) AND (EXISTS ( SELECT 1
   FROM ai_story_scene_executions scene
  WHERE ((scene.id = ai_story_scene_scheduling_correlations.scene_execution_id) AND (scene.execution_plan_id = ai_story_scene_scheduling_correlations.execution_plan_id) AND (scene.org_id = ai_story_scene_scheduling_correlations.org_id) AND (scene.workspace_id = ai_story_scene_scheduling_correlations.workspace_id))))));
CREATE POLICY "ai_story_scene_scheduling_select" ON "ai_story_scene_scheduling_correlations" AS PERMISSIVE FOR SELECT TO PUBLIC USING (((workspace_id IN ( SELECT user_workspace_ids() AS user_workspace_ids)) AND (org_id = ( SELECT workspaces.org_id
   FROM workspaces
  WHERE (workspaces.id = ai_story_scene_scheduling_correlations.workspace_id))) AND (EXISTS ( SELECT 1
   FROM ai_story_scene_routing_decisions decision
  WHERE ((decision.routing_decision_id = ai_story_scene_scheduling_correlations.routing_decision_id) AND (decision.scene_execution_id = ai_story_scene_scheduling_correlations.scene_execution_id) AND (decision.execution_plan_id = ai_story_scene_scheduling_correlations.execution_plan_id) AND (decision.runtime_authorization_id = ai_story_scene_scheduling_correlations.runtime_authorization_id) AND (decision.org_id = ai_story_scene_scheduling_correlations.org_id) AND (decision.workspace_id = ai_story_scene_scheduling_correlations.workspace_id)))) AND (EXISTS ( SELECT 1
   FROM ai_story_scene_executions scene
  WHERE ((scene.id = ai_story_scene_scheduling_correlations.scene_execution_id) AND (scene.execution_plan_id = ai_story_scene_scheduling_correlations.execution_plan_id) AND (scene.org_id = ai_story_scene_scheduling_correlations.org_id) AND (scene.workspace_id = ai_story_scene_scheduling_correlations.workspace_id))))));
ALTER TABLE "ai_story_story_review_facts" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_story_story_review_insert" ON "ai_story_story_review_facts" AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK (((workspace_id IN ( SELECT user_workspace_ids() AS user_workspace_ids)) AND (org_id = ( SELECT workspaces.org_id
   FROM workspaces
  WHERE (workspaces.id = ai_story_story_review_facts.workspace_id))) AND (EXISTS ( SELECT 1
   FROM ai_story_execution_plans plan
  WHERE ((plan.id = ai_story_story_review_facts.execution_plan_id) AND (plan.org_id = ai_story_story_review_facts.org_id) AND (plan.workspace_id = ai_story_story_review_facts.workspace_id) AND (plan.campaign_id = ai_story_story_review_facts.campaign_id) AND (plan.story_id = ai_story_story_review_facts.story_id) AND (plan.story_version_id = ai_story_story_review_facts.story_version_id) AND (plan.animation_package_id = ai_story_story_review_facts.animation_package_id)))) AND (EXISTS ( SELECT 1
   FROM campaigns campaign
  WHERE ((campaign.id = ai_story_story_review_facts.campaign_id) AND (campaign.workspace_id = ai_story_story_review_facts.workspace_id) AND (campaign.org_id = ai_story_story_review_facts.org_id)))) AND (EXISTS ( SELECT 1
   FROM ai_stories story
  WHERE ((story.id = ai_story_story_review_facts.story_id) AND (story.campaign_id = ai_story_story_review_facts.campaign_id) AND (story.workspace_id = ai_story_story_review_facts.workspace_id) AND (story.org_id = ai_story_story_review_facts.org_id)))) AND (EXISTS ( SELECT 1
   FROM ai_story_versions version
  WHERE ((version.id = ai_story_story_review_facts.story_version_id) AND (version.story_id = ai_story_story_review_facts.story_id)))) AND (EXISTS ( SELECT 1
   FROM ai_story_animation_packages package
  WHERE ((package.id = ai_story_story_review_facts.animation_package_id) AND (package.story_id = ai_story_story_review_facts.story_id) AND (package.story_version_id = ai_story_story_review_facts.story_version_id) AND (package.campaign_id = ai_story_story_review_facts.campaign_id) AND (package.workspace_id = ai_story_story_review_facts.workspace_id) AND (package.org_id = ai_story_story_review_facts.org_id))))));
CREATE POLICY "ai_story_story_review_select" ON "ai_story_story_review_facts" AS PERMISSIVE FOR SELECT TO PUBLIC USING (((workspace_id IN ( SELECT user_workspace_ids() AS user_workspace_ids)) AND (org_id = ( SELECT workspaces.org_id
   FROM workspaces
  WHERE (workspaces.id = ai_story_story_review_facts.workspace_id)))));
ALTER TABLE "assets" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "assets_all" ON "assets" AS PERMISSIVE FOR ALL TO PUBLIC USING ((workspace_id IN ( SELECT user_workspace_ids() AS user_workspace_ids))) WITH CHECK ((workspace_id IN ( SELECT user_workspace_ids() AS user_workspace_ids)));
ALTER TABLE "business_profiles" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "business_profiles_delete" ON "business_profiles" AS PERMISSIVE FOR DELETE TO PUBLIC USING ((workspace_id IN ( SELECT user_workspace_ids() AS user_workspace_ids)));
CREATE POLICY "business_profiles_insert" ON "business_profiles" AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK (((workspace_id IN ( SELECT user_workspace_ids() AS user_workspace_ids)) AND (org_id = ( SELECT workspaces.org_id
   FROM workspaces
  WHERE (workspaces.id = business_profiles.workspace_id)))));
CREATE POLICY "business_profiles_select" ON "business_profiles" AS PERMISSIVE FOR SELECT TO PUBLIC USING ((workspace_id IN ( SELECT user_workspace_ids() AS user_workspace_ids)));
CREATE POLICY "business_profiles_update" ON "business_profiles" AS PERMISSIVE FOR UPDATE TO PUBLIC USING ((workspace_id IN ( SELECT user_workspace_ids() AS user_workspace_ids))) WITH CHECK (((workspace_id IN ( SELECT user_workspace_ids() AS user_workspace_ids)) AND (org_id = ( SELECT workspaces.org_id
   FROM workspaces
  WHERE (workspaces.id = business_profiles.workspace_id)))));
ALTER TABLE "campaigns" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "campaigns_all" ON "campaigns" AS PERMISSIVE FOR ALL TO PUBLIC USING ((workspace_id IN ( SELECT user_workspace_ids() AS user_workspace_ids)));
ALTER TABLE "commercial_execution_authorizations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "creatives" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "creatives_all" ON "creatives" AS PERMISSIVE FOR ALL TO PUBLIC USING ((workspace_id IN ( SELECT user_workspace_ids() AS user_workspace_ids)));
ALTER TABLE "credit_reservations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "credit_wallets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "photo_scene_generations" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "photo_scene_generations_all" ON "photo_scene_generations" AS PERMISSIVE FOR ALL TO PUBLIC USING (((workspace_id IN ( SELECT user_workspace_ids() AS user_workspace_ids)) AND (campaign_id IN ( SELECT campaigns.id
   FROM campaigns
  WHERE (campaigns.workspace_id IN ( SELECT user_workspace_ids() AS user_workspace_ids))))));
ALTER TABLE "tasks" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tasks_all" ON "tasks" AS PERMISSIVE FOR ALL TO PUBLIC USING ((workspace_id IN ( SELECT user_workspace_ids() AS user_workspace_ids)));
ALTER TABLE "workspace_members" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "workspace_members_select" ON "workspace_members" AS PERMISSIVE FOR SELECT TO PUBLIC USING ((workspace_id IN ( SELECT user_workspace_ids() AS user_workspace_ids)));
ALTER TABLE "workspaces" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "workspace_select" ON "workspaces" AS PERMISSIVE FOR SELECT TO PUBLIC USING ((id IN ( SELECT user_workspace_ids() AS user_workspace_ids)));
COMMIT;
