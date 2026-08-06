/**
 * Sprint 3 Phase 2B PR 2B.5 — pure UI helpers for Review & Assembly.
 * Non-authoritative. Never unlocks execution.
 */
import type {
  ExecutionPlanReadiness,
  ExecutionPlanReviewAssemblyReadModel,
  LogicalReviewStatus,
  WorkspaceRole,
} from "@ceo-agent/shared";
import { PHASE1_EXECUTION_LOCKED } from "@ceo-agent/shared";

/** Roles allowed to open review / append decisions / create assembly (mirrors requireWorkspaceRole operator). */
export function canMutateReviewAssembly(role: WorkspaceRole | string | null | undefined): boolean {
  return role === "admin" || role === "operator";
}

export function canReadReviewAssembly(role: WorkspaceRole | string | null | undefined): boolean {
  return (
    role === "admin" ||
    role === "operator" ||
    role === "editor" ||
    role === "reviewer" ||
    role === "publisher" ||
    role === "client_viewer"
  );
}

export function formatReviewStatus(status: LogicalReviewStatus | string | null | undefined): string {
  switch (status) {
    case "UNDER_REVIEW":
      return "Under review";
    case "APPROVED":
      return "Approved";
    case "REJECTED":
      return "Rejected";
    default:
      return "Not opened";
  }
}

export function formatExecutionReadiness(
  readiness: ExecutionPlanReadiness | string | null | undefined
): string {
  switch (readiness) {
    case "READY_FOR_EXECUTION":
      return "Ready for execution";
    case "NOT_READY":
    default:
      return "Not ready";
  }
}

export function formatExecutionLockLabel(lockCode: string | null | undefined): string {
  if (lockCode === PHASE1_EXECUTION_LOCKED || !lockCode) {
    return "Locked until Phase 3";
  }
  return "Locked";
}

export function isStoryApproveEligible(
  model: Pick<ExecutionPlanReviewAssemblyReadModel, "review"> | null | undefined
): boolean {
  if (!model) return false;
  if (model.review.status === "REJECTED" || model.review.status === "APPROVED") return false;
  const scenes = model.review.scenes;
  if (scenes.length === 0) return false;
  return scenes.every(
    (scene) =>
      scene.decision === "APPROVED" &&
      (scene.qc == null || scene.qc.blockingFindingCount === 0)
  );
}

export function isAssemblyCreateAvailable(
  model: Pick<ExecutionPlanReviewAssemblyReadModel, "review" | "assemblyDefinition"> | null | undefined
): boolean {
  if (!model) return false;
  return model.review.status === "APPROVED";
}

export function reviewAssemblyErrorMessage(
  code: string | null | undefined,
  fallback = "Something went wrong"
): string {
  switch (code) {
    case "UNAUTHORIZED":
      return "Sign in to continue.";
    case "FORBIDDEN":
      return "You do not have permission for this action.";
    case "NOT_FOUND":
      return "Execution Plan or Review was not found.";
    case "OWNERSHIP_INTEGRITY_VIOLATION":
      return "This review request does not match the Execution Plan ownership chain.";
    case "REVIEW_IDENTITY_CONFLICT":
    case "EXECUTION_PLAN_REVIEW_IDENTITY_CONFLICT":
      return "A conflicting review fact already exists for this identity.";
    case "REVIEW_STATE_CONFLICT":
    case "EXECUTION_PLAN_REVIEW_STATE_INVALID":
      return "This review action conflicts with the current review state.";
    case "SCENE_REVIEW_NOT_ELIGIBLE":
      return "This Scene cannot be reviewed in the current state.";
    case "STORY_REVIEW_NOT_ELIGIBLE":
      return "Story approval requires every required Scene to be approved first.";
    case "ASSEMBLY_IDENTITY_CONFLICT":
      return "Assembly Definition identity conflicts with the accepted definition.";
    case "ASSEMBLY_INTEGRITY_VIOLATION":
      return "Assembly Definition integrity check failed. Reload and try again.";
    case "ASSEMBLY_STATE_INVALID":
      return "Assembly Definition requires an approved Story review.";
    case "PHASE1_EXECUTION_LOCKED":
      return "Execution remains locked until Phase 3.";
    case "VALIDATION_ERROR":
      return "Invalid request. Check your input and try again.";
    default:
      return fallback;
  }
}

/** Keys that must never appear in safe UI payloads / DOM dumps. */
export const FORBIDDEN_UI_PAYLOAD_KEYS = [
  "prompt",
  "negativePrompt",
  "negative_prompt",
  "systemPrompt",
  "system_prompt",
  "instructions",
  "instructionSnapshot",
  "instruction_snapshot",
  "providerPayload",
  "providerRequest",
  "providerResponse",
  "providerCredentials",
  "apiKey",
  "api_key",
  "signedUrl",
  "signed_url",
  "storageUri",
  "storage_uri",
  "DATABASE_URL",
] as const;

export function collectForbiddenPayloadKeys(value: unknown, path = "$"): string[] {
  const hits: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((item, i) => hits.push(...collectForbiddenPayloadKeys(item, `${path}[${i}]`)));
    return hits;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const lowered = key.toLowerCase();
      if (
        (FORBIDDEN_UI_PAYLOAD_KEYS as readonly string[]).includes(key) ||
        lowered.includes("credential") ||
        lowered === "apikey" ||
        lowered.includes("api_key")
      ) {
        hits.push(`${path}.${key}`);
      }
      hits.push(...collectForbiddenPayloadKeys(child, `${path}.${key}`));
    }
  }
  return hits;
}

export function executionPlanStorageKey(storyId: string): string {
  return `emberos:ai-story-execution-plan:${storyId}`;
}

export function shortenId(id: string | null | undefined, keep = 8): string {
  if (!id) return "—";
  if (id.length <= keep * 2 + 1) return id;
  return `${id.slice(0, keep)}…${id.slice(-4)}`;
}
