"use client";

/**
 * EXEC-04 — bounded generated Scene review surface.
 * Retry = same Scene, separately authorized paid attempt, new frozen input revision.
 */
import { useRef, useState } from "react";
import type { GeneratedSceneReviewReadModel, WorkspaceRole, HumanCreativeRejectionReason } from "@ceo-agent/shared";
import { useI18n } from "@/lib/i18n/provider";
import type { TranslationKey } from "@ceo-agent/shared/i18n";
import {
  StoryRuntimeClientError,
  postGeneratedSceneReviewDecision,
  postPreDispatchRecovery,
  postSceneRetryAuthorization,
  postSceneRetryInputRevision,
} from "@/lib/ai-story-runtime-client";

type Props = {
  campaignId: string;
  storyId: string;
  executionPlanId: string;
  workspaceRole: WorkspaceRole | string | null;
  scenes: readonly GeneratedSceneReviewReadModel[];
  onChanged: () => Promise<unknown>;
};

const OPERATOR_ROLES = new Set(["admin", "operator"]);

function shortId(value: string): string {
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}

const STATE_KEYS: Record<GeneratedSceneReviewReadModel["runtimeState"], TranslationKey> = {
  AUTHORIZED_NOT_RELEASED: "aiStory.generatedReview.state.AUTHORIZED_NOT_RELEASED",
  QUEUED: "aiStory.generatedReview.state.QUEUED",
  PRE_DISPATCH_BLOCKED: "aiStory.generatedReview.state.PRE_DISPATCH_BLOCKED",
  RUNNING: "aiStory.generatedReview.state.RUNNING",
  PENDING_REVIEW: "aiStory.generatedReview.state.PENDING_REVIEW",
  REJECTED: "aiStory.generatedReview.state.PENDING_REVIEW",
  RETRY_AUTHORIZED: "aiStory.generatedReview.state.QUEUED",
  APPROVED: "aiStory.generatedReview.state.APPROVED",
  FAILED: "aiStory.generatedReview.state.FAILED",
};

export function GeneratedSceneReviewPanel({
  campaignId,
  storyId,
  executionPlanId,
  workspaceRole,
  scenes,
  onChanged,
}: Props) {
  const { t } = useI18n();
  const canDecide = OPERATOR_ROLES.has(String(workspaceRole ?? ""));
  const [busyScene, setBusyScene] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const [rejectionReasons, setRejectionReasons] = useState<
    Record<string, HumanCreativeRejectionReason>
  >({});
  const [revisionIds, setRevisionIds] = useState<Record<string, string>>({});
  const [authorizationIds, setAuthorizationIds] = useState<Record<string, string>>({});

  if (scenes.length === 0) return null;

  async function decide(
    scene: GeneratedSceneReviewReadModel,
    action: "approve" | "retry" | "reject"
  ) {
    if (!canDecide || inFlight.current) return;
    inFlight.current = true;
    setBusyScene(scene.sceneExecutionId);
    setError(null);
    try {
      await postGeneratedSceneReviewDecision({
        campaignId,
        storyId,
        executionPlanId,
        sceneExecutionId: scene.sceneExecutionId,
        action,
        attemptId: scene.latestAttemptId ?? undefined,
        ...(action === "reject"
          ? {
              rejection: {
                reason:
                  rejectionReasons[scene.sceneExecutionId] ??
                  "INSUFFICIENT_SCENE_DIFFERENTIATION",
              },
            }
          : {}),
        ...(action === "retry"
          ? {
              retryAuthorizationId:
                authorizationIds[scene.sceneExecutionId] ??
                scene.retryAuthorizationId ??
                undefined,
            }
          : {}),
      });
      await onChanged();
    } catch (err) {
      setError(
        err instanceof StoryRuntimeClientError
          ? `${err.message}${err.requestCorrelationId ? ` (reference ${err.requestCorrelationId})` : ""}`
          : err instanceof Error
            ? err.message
            : t("aiStory.generatedReview.error")
      );
    } finally {
      inFlight.current = false;
      setBusyScene(null);
    }
  }

  async function createRevision(scene: GeneratedSceneReviewReadModel) {
    if (!scene.latestReviewId || inFlight.current) return;
    inFlight.current = true;
    setBusyScene(scene.sceneExecutionId);
    setError(null);
    try {
      const revision = await postSceneRetryInputRevision({
        campaignId,
        storyId,
        executionPlanId,
        sceneExecutionId: scene.sceneExecutionId,
        sourceReviewId: scene.latestReviewId,
        // These are bounded Director controls, not a provider payload. The
        // server compares them to the immutable source input and re-certifies
        // Campaign Product / FIRST_FRAME_I2V authority.
        creativeDirection: {
          visualRole: "SECONDARY_DETAIL_REVEAL",
          cameraInstruction: "MINOR_LATERAL_DOLLY",
          focusProgression: ["PRIMARY_PRODUCT_DETAIL", "SECONDARY_PRODUCT_DETAIL"],
          shotEmphasis: "DISTINCT_SCENE_VISUAL_BEAT",
          pacing: "SMALL_BOUNDED",
        },
      });
      setRevisionIds((current) => ({
        ...current,
        [scene.sceneExecutionId]: revision.retryInputRevisionId,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("aiStory.generatedReview.error"));
    } finally {
      inFlight.current = false;
      setBusyScene(null);
    }
  }
  async function authorizeRetry(scene: GeneratedSceneReviewReadModel) {
    const revisionId =
      revisionIds[scene.sceneExecutionId] ?? scene.retryInputRevisionId;
    if (!scene.latestReviewId || !revisionId || inFlight.current) return;
    inFlight.current = true;
    setBusyScene(scene.sceneExecutionId);
    setError(null);
    try {
      const authorization = await postSceneRetryAuthorization({
        campaignId,
        storyId,
        executionPlanId,
        sceneExecutionId: scene.sceneExecutionId,
        sourceReviewId: scene.latestReviewId,
        retryInputRevisionId: revisionId,
      });
      setAuthorizationIds((current) => ({
        ...current,
        [scene.sceneExecutionId]: authorization.retryAuthorizationId,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("aiStory.generatedReview.error"));
    } finally {
      inFlight.current = false;
      setBusyScene(null);
    }
  }

  async function recover(scene: GeneratedSceneReviewReadModel) {
    if (
      !canDecide ||
      inFlight.current ||
      scene.runtimeState !== "PRE_DISPATCH_BLOCKED" ||
      scene.recoveryMode !== "HUMAN_RETRY_FROM_PRE_PROVIDER_FAILURE"
    ) return;
    inFlight.current = true;
    setBusyScene(scene.sceneExecutionId);
    setError(null);
    try {
      await postPreDispatchRecovery({
        campaignId,
        storyId,
        executionPlanId,
        sceneExecutionId: scene.sceneExecutionId,
      });
      await onChanged();
    } catch (err) {
      setError(
        err instanceof StoryRuntimeClientError
          ? `${err.message}${err.requestCorrelationId ? ` (reference ${err.requestCorrelationId})` : ""}`
          : err instanceof Error ? err.message : t("aiStory.generatedReview.error")
      );
    } finally {
      inFlight.current = false;
      setBusyScene(null);
    }
  }

  return (
    <section
      className="space-y-4 rounded-2xl border border-border bg-white p-5"
      data-testid="generated-scene-review-panel"
    >
      <div>
        <h2 className="text-lg font-bold text-navy">{t("aiStory.generatedReview.title")}</h2>
        <p className="mt-1 text-sm text-ink-secondary">
          {t("aiStory.generatedReview.subtitle")}
        </p>
      </div>
      <div className="space-y-3">
        {scenes.map((scene) => {
          const retryInputRevisionId =
            revisionIds[scene.sceneExecutionId] ?? scene.retryInputRevisionId;
          const retryAuthorizationId =
            authorizationIds[scene.sceneExecutionId] ??
            scene.retryAuthorizationId;
          const pending =
            scene.runtimeState === "PENDING_REVIEW" &&
            scene.reviewState === "PENDING_REVIEW" &&
            scene.reviewAvailable &&
            Boolean(scene.latestAttemptId && scene.generatedMedia) &&
            !scene.running;
          const canRetry =
            pending && scene.retryRemaining > 0 && scene.reviewState !== "REJECTED_TERMINAL";
          return (
            <div
              key={scene.sceneExecutionId}
              className="rounded-xl border border-border px-4 py-3"
              data-testid={`generated-scene-review-${scene.sceneOrder}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-navy">
                  {t("aiStory.generatedReview.sceneLabel", {
                    order: scene.sceneOrder + 1,
                    sceneId: scene.sceneId,
                  })}
                </p>
                <span className="text-xs text-ink-secondary">
                  {t(STATE_KEYS[scene.runtimeState])}
                </span>
              </div>
              <p className="mt-1 text-xs text-ink-secondary">
                {t("aiStory.generatedReview.attemptMeta", {
                  attempt: scene.latestAttemptNumber ?? 0,
                  remaining: scene.retryRemaining,
                  cost:
                    scene.sceneKnownCost == null
                      ? t("aiStory.generatedReview.costUnknown")
                      : `$${scene.sceneKnownCost}`,
                })}
              </p>
              {scene.generatedMedia ? (
                <div
                  className="mt-3 space-y-2"
                  data-testid={`generated-scene-media-${scene.sceneOrder}`}
                >
                  {scene.generatedMedia.deliveryUrl ? (
                    <video
                      className="w-full rounded-xl border border-border bg-black"
                      controls
                      preload="metadata"
                      src={scene.generatedMedia.deliveryUrl}
                      data-testid={`generated-scene-media-preview-${scene.sceneOrder}`}
                    >
                      Your browser does not support video playback.
                    </video>
                  ) : (
                    <p
                      className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
                      data-testid={`generated-scene-media-error-${scene.sceneOrder}`}
                    >
                      {scene.generatedMedia.safeError ??
                        "Scene media preview is temporarily unavailable."}
                    </p>
                  )}
                  <p className="text-xs text-ink-secondary">
                    Result {shortId(scene.generatedMedia.sceneResultId)} · Attempt{" "}
                    {shortId(scene.generatedMedia.providerAttemptId)}
                  </p>
                </div>
              ) : null}
              {canDecide && pending ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <select
                    aria-label="Creative rejection reason"
                    value={
                      rejectionReasons[scene.sceneExecutionId] ??
                      "INSUFFICIENT_SCENE_DIFFERENTIATION"
                    }
                    onChange={(event) =>
                      setRejectionReasons((current) => ({
                        ...current,
                        [scene.sceneExecutionId]: event.target
                          .value as HumanCreativeRejectionReason,
                      }))
                    }
                  >
                    <option value="INSUFFICIENT_SCENE_DIFFERENTIATION">Insufficient scene differentiation</option>
                    <option value="PRODUCT_IDENTITY_DRIFT">Product identity drift</option>
                    <option value="COMPOSITION_UNACCEPTABLE">Composition unacceptable</option>
                    <option value="CAMERA_MOTION_UNACCEPTABLE">Camera motion unacceptable</option>
                    <option value="VISUAL_QUALITY_UNACCEPTABLE">Visual quality unacceptable</option>
                    <option value="CONTINUITY_UNACCEPTABLE">Continuity unacceptable</option>
                  </select>
                  <button
                    type="button"
                    className="brand-btn-primary"
                    disabled={busyScene === scene.sceneExecutionId}
                    data-testid={`generated-scene-approve-${scene.sceneOrder}`}
                    onClick={() => void decide(scene, "approve")}
                  >
                    {t("aiStory.generatedReview.approve")}
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-border px-3 py-1.5 text-sm"
                    disabled={busyScene === scene.sceneExecutionId || !canRetry}
                    data-testid={`generated-scene-retry-${scene.sceneOrder}`}
                    onClick={() => void decide(scene, "retry")}
                  >
                    {t("aiStory.generatedReview.retry")}
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-800"
                    disabled={busyScene === scene.sceneExecutionId}
                    data-testid={`generated-scene-reject-${scene.sceneOrder}`}
                    onClick={() => void decide(scene, "reject")}
                  >
                    {t("aiStory.generatedReview.reject")}
                  </button>
                </div>
              ) : null}
              {canDecide &&
              (scene.runtimeState === "REJECTED" ||
                scene.runtimeState === "RETRY_AUTHORIZED") ? (
                <div className="mt-3 space-y-2" data-testid={`generated-scene-revise-retry-${scene.sceneOrder}`}>
                  <p className="text-sm text-ink-secondary">Rejected — retry available. Review a bounded differentiated input before authorizing paid generation.</p>
                  {!retryInputRevisionId ? (
                    <button type="button" className="rounded-lg border border-border px-3 py-1.5 text-sm" onClick={() => void createRevision(scene)} disabled={busyScene === scene.sceneExecutionId}>
                      Review Retry Input
                    </button>
                  ) : null}
                  {retryInputRevisionId && !retryAuthorizationId ? (
                    <button type="button" className="rounded-lg border border-border px-3 py-1.5 text-sm" onClick={() => void authorizeRetry(scene)} disabled={busyScene === scene.sceneExecutionId}>
                      Authorize Retry
                    </button>
                  ) : null}
                  {retryAuthorizationId ? (
                    <button type="button" className="brand-btn-primary" onClick={() => void decide(scene, "retry")} disabled={busyScene === scene.sceneExecutionId}>
                      Start paid retry
                    </button>
                  ) : null}
                </div>
              ):null}
              {canDecide &&
              scene.runtimeState === "PRE_DISPATCH_BLOCKED" &&
              scene.recoveryMode === "HUMAN_RETRY_FROM_PRE_PROVIDER_FAILURE" ? (
                <div className="mt-3" data-testid={`generated-scene-pre-dispatch-recovery-${scene.sceneOrder}`}>
                  <button
                    type="button"
                    className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm text-amber-900"
                    disabled={busyScene === scene.sceneExecutionId}
                    onClick={() => void recover(scene)}
                    data-testid={`generated-scene-recover-pre-dispatch-${scene.sceneOrder}`}
                  >
                    {t("aiStory.generatedReview.preDispatchRecovery")}
                  </button>
                  <p className="mt-1 text-xs text-ink-secondary">
                    {t("aiStory.generatedReview.preDispatchRecoveryHint")}
                  </p>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {error ? (
        <p className="text-sm text-red-700" data-testid="generated-scene-review-error">
          {error}
        </p>
      ) : null}
    </section>
  );
}
