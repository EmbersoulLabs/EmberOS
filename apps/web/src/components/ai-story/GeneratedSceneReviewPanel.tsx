"use client";

/**
 * EXEC-04 — bounded generated Scene review surface.
 * Retry = same Scene, new provider attempt, same frozen input.
 */
import { useRef, useState } from "react";
import type { GeneratedSceneReviewReadModel, WorkspaceRole } from "@ceo-agent/shared";
import { useI18n } from "@/lib/i18n/provider";
import type { TranslationKey } from "@ceo-agent/shared/i18n";
import {
  StoryRuntimeClientError,
  postGeneratedSceneReviewDecision,
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

const STATE_KEYS: Record<GeneratedSceneReviewReadModel["reviewState"], TranslationKey> = {
  PENDING_REVIEW: "aiStory.generatedReview.state.PENDING_REVIEW",
  APPROVED: "aiStory.generatedReview.state.APPROVED",
  RETRY_REQUESTED: "aiStory.generatedReview.state.RETRY_REQUESTED",
  REJECTED_TERMINAL: "aiStory.generatedReview.state.REJECTED_TERMINAL",
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
      });
      await onChanged();
    } catch (err) {
      setError(
        err instanceof StoryRuntimeClientError
          ? err.message
          : err instanceof Error
            ? err.message
            : t("aiStory.generatedReview.error")
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
          const pending = scene.reviewState === "PENDING_REVIEW" && !scene.running;
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
                  {t(STATE_KEYS[scene.reviewState])}
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
