"use client";

/**
 * Sprint 3 PR 3.7 Phase E — minimal Story Runtime panel.
 * Execute → poll runtime → show progress / failures → Final Story Video.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ProductRuntimeProjection, WorkspaceRole } from "@ceo-agent/shared";
import type { TranslationKey } from "@ceo-agent/shared/i18n";
import { FinalStoryResultViewer } from "@/components/ai-story/FinalStoryResultViewer";
import { SceneReviewWorkspacePanel } from "@/components/ai-story/SceneReviewWorkspacePanel";
import { EpisodePreviewPanel } from "@/components/ai-story/EpisodePreviewPanel";
import { EpisodeDebugPanel } from "@/components/ai-story/EpisodeDebugPanel";
import {
  AI_STORY_EPISODE_COPY,
  classifyEpisodeMomentRepair,
  episodeMomentMarker,
  formatEpisodeActualCostUsd,
  resolveInternalRetryScopeFromEpisodeMoment,
  shouldExposeSceneDiagnostics,
  type AiStoryEpisodeTimelineMoment,
} from "@ceo-agent/shared";
import { useI18n } from "@/lib/i18n/provider";
import {
  StoryRuntimeClientError,
  getProductRuntimeProjection,
  postCanonicalExecute,
  postGeneratedSceneReviewDecision,
  postPreDispatchRecovery,
  postReleaseNextEligibleScene,
} from "@/lib/ai-story-runtime-client";
import { readInitialRuntimeOnce, readRuntimeAfterUserRetry } from "@/lib/ai-story-runtime-initial-read-policy";
import {
  PRODUCT_RUNTIME_POLL_INTERVAL_MS,
  canShowExecuteButton,
  isWaitingForHumanReview,
  shouldPollRuntimeProjection,
  stabilizeRuntimeMediaSources,
} from "@/lib/ai-story-runtime-ui";

type Props = {
  campaignId: string;
  storyId: string;
  executionPlanId: string;
  workspaceRole: WorkspaceRole | string | null;
};

function statusKey(status: string | null | undefined): TranslationKey {
  const key = `aiStory.runtime.status.${status ?? "NOT_READY"}`;
  return key as TranslationKey;
}

export function StoryRuntimePanel({
  campaignId,
  storyId,
  executionPlanId,
  workspaceRole,
}: Props) {
  const { t } = useI18n();
  const showExecuteChrome = canShowExecuteButton(workspaceRole);
  const [projection, setProjection] = useState<ProductRuntimeProjection | null>(null);
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const executeInFlight = useRef(false);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const requestGen = useRef(0);
  const runtimeReadInFlight = useRef<Promise<ProductRuntimeProjection | null> | null>(null);
  const runtimeReadAbort = useRef<AbortController | null>(null);

  const clearPoll = useCallback(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const refresh = useCallback((): Promise<ProductRuntimeProjection | null> => {
    if (runtimeReadInFlight.current) return runtimeReadInFlight.current;
    const gen = ++requestGen.current;
    const controller = new AbortController();
    runtimeReadAbort.current = controller;
    setLoading(true);
    const read = (async () => {
      try {
        const next = await getProductRuntimeProjection({
        campaignId,
        storyId,
        executionPlanId,
        signal: controller.signal,
      });
        if (gen !== requestGen.current) return next;
        let stable = next;
        setProjection((current) => {
          stable = stabilizeRuntimeMediaSources(current, next);
          return stable;
        });
        setError(null);
        return stable;
      } catch (err) {
        if (gen !== requestGen.current) return null;
        setError(
          err instanceof StoryRuntimeClientError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Story review could not be loaded."
        );
        return null;
      } finally {
        if (gen === requestGen.current) {
          runtimeReadInFlight.current = null;
          runtimeReadAbort.current = null;
          setLoading(false);
        }
      }
    })();
    runtimeReadInFlight.current = read;
    return read;
  }, [campaignId, storyId, executionPlanId]);

  const ensurePolling = useCallback(
    (nextProjection: ProductRuntimeProjection | null | undefined) => {
      clearPoll();
      if (!shouldPollRuntimeProjection(nextProjection)) return;
      pollTimer.current = setInterval(() => {
        if (document.visibilityState === "hidden" || runtimeReadInFlight.current) return;
        void refresh();
      }, PRODUCT_RUNTIME_POLL_INTERVAL_MS);
    },
    [clearPoll, refresh]
  );

  useEffect(() => {
    setLoading(true);
    void (async () => {
      const next = await readInitialRuntimeOnce(refresh);
      ensurePolling(next);
    })();
    return () => {
      requestGen.current += 1;
      runtimeReadAbort.current?.abort();
      runtimeReadAbort.current = null;
      runtimeReadInFlight.current = null;
      clearPoll();
    };
  }, [refresh, ensurePolling, clearPoll]);

  useEffect(() => {
    ensurePolling(projection);
  }, [projection, ensurePolling]);

  async function onExecute() {
    if (!showExecuteChrome) return;
    if (executeInFlight.current || executing) return;
    if (projection && !projection.canExecute) return;

    executeInFlight.current = true;
    setExecuting(true);
    setError(null);
    try {
      await postCanonicalExecute({ campaignId, storyId, executionPlanId });
      const next = await refresh();
      ensurePolling(next);
    } catch (err) {
      if (err instanceof StoryRuntimeClientError) {
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : "Execute failed");
      }
    } finally {
      executeInFlight.current = false;
      setExecuting(false);
    }
  }

  async function onReleaseNextScene() {
    if (!projection?.remainingReleasePermitted || releasing) return;
    setReleasing(true); setError(null);
    try {
      await postReleaseNextEligibleScene({ campaignId, storyId, executionPlanId });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The next moment could not continue");
    } finally { setReleasing(false); }
  }

  async function onRepairMoment(moment: AiStoryEpisodeTimelineMoment) {
    const scope = resolveInternalRetryScopeFromEpisodeMoment(moment);
    const scene = (projection?.generatedSceneReviews ?? []).find(
      (row) => row.sceneExecutionId === scope.generationUnitId || row.sceneId === scope.sceneId
    );
    if (typeof document !== "undefined") {
      document.getElementById(`scene-${scope.sceneOrder + 1}`)?.scrollIntoView({ behavior: "smooth" });
    }
    const authority = classifyEpisodeMomentRepair({
      runtimeState: scene?.runtimeState ?? moment.runtimeState,
      retryAuthorizationId: scene?.retryAuthorizationId ?? moment.retryAuthorizationId,
      sceneExecutionId: scene?.sceneExecutionId ?? scope.generationUnitId,
    });
    if (authority.kind === "BACKEND_GAP") {
      setError(authority.reason);
      return;
    }
    if (!scene) {
      setError(AI_STORY_EPISODE_COPY.regenerateRequiresRetryAuth);
      return;
    }
    try {
      if (authority.kind === "PRE_DISPATCH_RECOVERY") {
        await postPreDispatchRecovery({
          campaignId,
          storyId,
          executionPlanId,
          sceneExecutionId: authority.sceneExecutionId,
        });
      } else {
        await postGeneratedSceneReviewDecision({
          campaignId,
          storyId,
          executionPlanId,
          sceneExecutionId: authority.sceneExecutionId,
          action: "retry",
          retryAuthorizationId: authority.retryAuthorizationId,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "This moment could not be generated.");
      return;
    }
    await refresh();
  }

  const waitingForHumanReview = isWaitingForHumanReview(projection);
  const statusLabel = waitingForHumanReview
    ? t("aiStory.runtime.waitingForHumanReview")
    : t(statusKey(projection?.status));
  const canExecute =
    showExecuteChrome && Boolean(projection?.canExecute) && !executing && !loading;

  return (
    <div className="space-y-4" data-testid="story-runtime-panel">
      <section className="space-y-4 rounded-2xl border border-border bg-white p-5">
        <div>
          <h2 className="text-lg font-bold text-navy">Generating episode moments</h2>
          <p className="mt-1 text-sm text-ink-secondary">
            Follow your Episode from generation through review. Progress comes from saved server state.
          </p>
        </div>

        <div
          className="flex flex-wrap items-center gap-3"
          data-testid="story-runtime-status"
        >
          <span className="rounded-lg border border-border bg-surface-muted px-3 py-1.5 text-sm font-medium text-navy">
            {loading && !projection ? t("aiStory.runtime.loading") : statusLabel}
          </span>
          {projection ? (
            <span
              className="text-sm text-ink-secondary"
              data-testid="story-runtime-progress"
            >
              {t("aiStory.runtime.progress", {
                succeeded: projection.succeededSceneCount,
                required: projection.requiredSceneCount,
              })}
              {(projection.pendingReviewSceneCount ?? 0) > 0
                ? ` · ${t("aiStory.runtime.pendingHumanReview")}`
                : (projection.approvedSceneCount ?? 0) > 0 &&
                    projection.approvedSceneCount === projection.requiredSceneCount
                  ? ` · ${t("aiStory.runtime.sceneApprovedByReviewer")}`
                  : ""}
              {projection.failedSceneCount > 0
                ? ` · ${projection.failedSceneCount} failed`
                : ""}
              {projection.providerSpend && projection.providerSpend.attemptCount > 0
                ? ` · ${
                    projection.providerSpend.storyKnownAmount == null
                      ? "provider spend unknown"
                      : `$${projection.providerSpend.storyKnownAmount} ${projection.providerSpend.currency}`
                  }${
                    projection.providerSpend.unknownAttemptCount > 0
                      ? ` (${projection.providerSpend.unknownAttemptCount} unknown)`
                      : ""
                  }`
                : ""}
            </span>
          ) : null}
        </div>

        {showExecuteChrome ? (
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={!canExecute}
              onClick={() => void onExecute()}
              className="brand-btn-primary"
              data-testid="canonical-execute"
            >
              {executing
                ? t("aiStory.runtime.executing")
                : "Generate Episode"}
            </button>
            {projection?.remainingReleasePermitted ? (
               <button type="button" disabled={releasing} onClick={() => void onReleaseNextScene()}
                 className="brand-btn-primary" data-testid="release-next-scene" data-authority-action="Release Scene">
                {releasing ? "Continuing…" : "Continue Episode"}
              </button>
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-ink-secondary" data-testid="viewer-execute-hidden">
            {t("aiStory.runtime.viewerReadonly")}
          </p>
        )}

        <button
          type="button"
          className="rounded-lg border border-border px-3 py-1.5 text-sm"
          disabled={loading}
          onClick={() => void refresh()}
          data-testid="story-runtime-manual-refresh"
        >
          {loading ? t("aiStory.runtime.refreshing") : t("aiStory.runtime.refresh")}
        </button>

        {projection?.status === "RECONCILIATION_REQUIRED" ? (
          <div
            className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
            data-testid="reconciliation-message"
          >
            {projection.safeFailureSummary ?? t("aiStory.runtime.reconciliation")}
          </div>
        ) : null}

        {(projection?.heldSceneCount ?? 0) > 0 ? (
          <p className="text-sm text-ink-secondary" data-testid="held-scenes-status">
            {projection?.remainingReleasePermitted
              ? "The next moment is ready"
              : `${projection?.heldSceneCount} moment(s) waiting`}
          </p>
        ) : null}

        {projection?.status === "SCENES_FAILED" ||
        projection?.status === "ASSEMBLY_FAILED" ? (
          <div
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900"
            data-testid="runtime-failure-message"
          >
            {projection.safeFailureSummary ?? "Story runtime failed."}
          </div>
        ) : null}

        {error ? (
          <div className="space-y-2" data-testid="story-runtime-error">
            <p className="text-sm text-red-700">{error}</p>
            <button
              type="button"
              className="rounded-lg border border-border px-3 py-1.5 text-sm"
              onClick={() => void readRuntimeAfterUserRetry(refresh)}
              disabled={loading}
              data-testid="story-runtime-read-retry"
            >
              Retry loading review
            </button>
          </div>
        ) : null}
      </section>

      <EpisodePreviewPanel
        title="Episode Preview"
        durationLabel="00:48"
        statusLabel={statusLabel}
        videoUrl={projection?.generatedSceneReviews?.find((scene) => scene.generatedMedia?.deliveryUrl)?.generatedMedia?.deliveryUrl}
        actualCostLabel={
          projection?.providerSpend?.storyKnownAmount != null
            ? formatEpisodeActualCostUsd(String(projection.providerSpend.storyKnownAmount))
            : undefined
        }
        moments={(projection?.generatedSceneReviews ?? []).map((scene) => ({
          startMs: 0,
          endMs: 0,
          marker: episodeMomentMarker(scene.sceneOrder),
          generationUnitId: scene.sceneExecutionId,
          directorShotId: scene.sceneExecutionId,
          sceneId: scene.sceneId ?? scene.sceneExecutionId,
          sceneOrder: scene.sceneOrder,
          status: (scene.runtimeState === "FAILED"
            ? "failed"
            : scene.runtimeState === "RUNNING"
              ? "generating"
              : scene.runtimeState === "PRE_DISPATCH_BLOCKED" || scene.runtimeState === "RETRY_AUTHORIZED"
                ? "needs_attention"
                : "ready") as AiStoryEpisodeTimelineMoment["status"],
          runtimeState: scene.runtimeState,
          retryAuthorizationId: scene.retryAuthorizationId,
          timeRangeAuthority: "BACKEND_GAP",
        }))}
        readyCount={(projection?.generatedSceneReviews ?? []).filter((scene) => scene.runtimeState !== "FAILED").length}
        onRepairMoment={(moment) => { void onRepairMoment(moment); }}
      />
      <EpisodeDebugPanel
        visible={shouldExposeSceneDiagnostics({ superAdmin: workspaceRole === "admin", debugMode: false })}
        moments={(projection?.generatedSceneReviews ?? []).map((scene) => ({
          startMs: scene.sceneOrder * 8000,
          endMs: (scene.sceneOrder + 1) * 8000,
          marker: episodeMomentMarker(scene.sceneOrder),
          generationUnitId: scene.sceneExecutionId,
          directorShotId: scene.sceneExecutionId,
          sceneId: scene.sceneId ?? scene.sceneExecutionId,
          sceneOrder: scene.sceneOrder,
          status: "ready" as const,
        }))}
      />

      <SceneReviewWorkspacePanel
        campaignId={campaignId}
        storyId={storyId}
        executionPlanId={executionPlanId}
        workspaceRole={workspaceRole}
        scenes={projection?.generatedSceneReviews ?? []}
        onChanged={refresh}
      />

      <FinalStoryResultViewer
        campaignId={campaignId}
        storyId={storyId}
        executionPlanId={executionPlanId}
        enabled={projection?.status === "SUCCEEDED" || Boolean(projection?.hasFinalStoryResult)}
      />
    </div>
  );
}
