/**
 * Bounded AI Story overlay production ops.
 * Read-only preflight helpers. Does not apply SQL.
 */
export const AI_STORY_PRODUCTION_SUPABASE_REF = "egkgybrjmzukzmkcrpag";
export const AI_STORY_PROD_MIGRATION_ACK = "AI_STORY_SELF_USE_V1";

export const AI_STORY_REQUIRED_TABLES = [
  "ai_stories",
  "ai_story_versions",
  "ai_story_asset_links",
  "ai_story_creative_contexts",
  "ai_story_animation_packages",
  "ai_story_scene_instruction_snapshots",
  "ai_story_execution_plans",
  "ai_story_scene_executions",
  "ai_story_scene_intent_validation_results",
  "ai_story_review_opened_facts",
  "ai_story_scene_intent_review_facts",
  "ai_story_story_review_facts",
  "ai_story_assembly_definitions",
  "ai_story_assembly_scene_memberships",
  "ai_story_execution_jobs",
  "ai_story_execution_outputs",
  "ai_story_runtime_authorized_facts",
  "ai_story_scene_routing_decisions",
  "ai_story_scene_scheduling_correlations",
  "ai_story_worker_execution_results",
  "ai_story_worker_attempt_observations",
  "ai_story_assembly_jobs",
  "ai_story_assembly_job_facts",
  "ai_story_assembly_artifacts",
  "ai_story_final_story_results",
  "ai_story_durable_scene_media_attestations",
  "ai_story_scene_projection_correlations",
  "ai_story_scene_results",
] as const;

export const AI_STORY_STRUCTURAL_TABLES = [
  "provider_executions",
  "provider_attempts",
  "provider_attempt_usage",
  "provider_attempt_costs",
  "provider_outbox_jobs",
  "provider_execution_envelopes",
  "provider_execution_dispatches",
  "platform_admin_grants",
  "platform_admin_revocations",
  "admin_audit_events",
  "billing_accounts",
  "subscription_events",
  "subscription_projections",
  "entitlement_grants",
  "entitlement_revocations",
  "effective_entitlement_projections",
  "credit_wallets",
  "credit_ledger_entries",
  "credit_reservations",
  "credit_settlements",
  "credit_releases",
  "product_usage_events",
  "commercial_execution_authorizations",
  "admin_runtime_recovery_receipts",
] as const;

export function isAiStoryProductionRef(databaseRef: string | null): boolean {
  return databaseRef === AI_STORY_PRODUCTION_SUPABASE_REF;
}
