/**
 * Sprint 3 PR 3.7 Phase E — pure UI helpers for product runtime status.
 */
import type { ProductRuntimeProjection, ProductRuntimeStatus, WorkspaceRole } from "@ceo-agent/shared";
import { isProductRuntimePollingStatus } from "@ceo-agent/shared";

export function canShowExecuteButton(role: WorkspaceRole | string | null | undefined): boolean {
  return role === "admin" || role === "operator";
}

export function formatProductRuntimeStatus(
  status: ProductRuntimeStatus | string | null | undefined
): string {
  switch (status) {
    case "READY_FOR_EXECUTION":
      return "Ready";
    case "AUTHORIZED":
      return "Starting";
    case "SCENES_RUNNING":
      return "Scenes running";
    case "RECONCILIATION_REQUIRED":
      return "Reconciliation required";
    case "SCENES_FAILED":
      return "Scene generation failed";
    case "SCENES_COMPLETE":
      return "Scenes complete";
    case "WAITING_FOR_ASSEMBLY":
      return "Waiting for assembly";
    case "ASSEMBLING":
      return "Assembling";
    case "ASSEMBLY_FAILED":
      return "Assembly failed";
    case "SUCCEEDED":
      return "Completed";
    case "NOT_READY":
    default:
      return "Not ready";
  }
}

export function shouldPollProductRuntime(
  status: ProductRuntimeStatus | string | null | undefined
): boolean {
  if (!status) return false;
  return isProductRuntimePollingStatus(status as ProductRuntimeStatus);
}

export const HUMAN_REVIEW_WAIT_STATE = "WAITING_FOR_HUMAN_REVIEW" as const;

/**
 * UI-only state derived from server-authoritative runtime rows. Held later
 * Scenes are deliberately not active work: a reviewer must act before the
 * staged-release workflow may continue.
 */
export function isWaitingForHumanReview(
  projection: ProductRuntimeProjection | null | undefined
): boolean {
  if (!projection || (projection.pendingReviewSceneCount ?? 0) === 0) return false;
  const activeSceneWork = (projection.generatedSceneReviews ?? []).some(
    (scene) => scene.running || scene.generatedMedia?.deliveryStatus === "PENDING"
  );
  return !activeSceneWork;
}

export function shouldPollRuntimeProjection(
  projection: ProductRuntimeProjection | null | undefined
): boolean {
  if (!projection || isWaitingForHumanReview(projection)) return false;
  return shouldPollProductRuntime(projection.status);
}

const SIGNED_URL_REFRESH_WINDOW_MS = 60_000;

function sameDurableMedia(
  left: NonNullable<NonNullable<ProductRuntimeProjection["generatedSceneReviews"]>[number]["generatedMedia"]>,
  right: NonNullable<NonNullable<ProductRuntimeProjection["generatedSceneReviews"]>[number]["generatedMedia"]>
): boolean {
  return left.mediaId === right.mediaId &&
    left.sceneResultId === right.sceneResultId &&
    left.providerAttemptId === right.providerAttemptId;
}

/**
 * Keep an already-playing signed source while its durable media identity is
 * unchanged and the URL is not near expiry. Ephemeral URLs never become media
 * identity and are never persisted.
 */
export function stabilizeRuntimeMediaSources(
  previous: ProductRuntimeProjection | null,
  next: ProductRuntimeProjection,
  nowMs = Date.now()
): ProductRuntimeProjection {
  if (!previous?.generatedSceneReviews || !next.generatedSceneReviews) return next;
  const priorScenes = new Map(
    previous.generatedSceneReviews.map((scene) => [scene.sceneExecutionId, scene])
  );
  return {
    ...next,
    generatedSceneReviews: next.generatedSceneReviews.map((scene) => {
      const priorMedia = priorScenes.get(scene.sceneExecutionId)?.generatedMedia;
      const nextMedia = scene.generatedMedia;
      if (!priorMedia?.deliveryUrl || !nextMedia || !sameDurableMedia(priorMedia, nextMedia)) {
        return scene;
      }
      const expiresAtMs = priorMedia.expiresAt ? Date.parse(priorMedia.expiresAt) : Number.NaN;
      if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs + SIGNED_URL_REFRESH_WINDOW_MS) {
        return scene;
      }
      return {
        ...scene,
        generatedMedia: {
          ...nextMedia,
          deliveryUrl: priorMedia.deliveryUrl,
          expiresAt: priorMedia.expiresAt,
        },
      };
    }),
  };
}

export const PRODUCT_RUNTIME_POLL_INTERVAL_MS = 4_000;
