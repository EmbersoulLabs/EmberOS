"use client";

/**
 * Sprint 3 PR 3.7 Phase E — minimal Story Runtime panel.
 * Execute → poll runtime → show progress / failures → Final Story Video.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ProductRuntimeProjection, WorkspaceRole } from "@ceo-agent/shared";
import type { TranslationKey } from "@ceo-agent/shared/i18n";
import { FinalStoryResultViewer } from "@/components/ai-story/FinalStoryResultViewer";
import { GeneratedSceneReviewPanel } from "@/components/ai-story/GeneratedSceneReviewPanel";
import { useI18n } from "@/lib/i18n/provider";
import {
  StoryRuntimeClientError,
  getProductRuntimeProjection,
  postCanonicalExecute,
  postReleaseRemainingScenes,
} from "@/lib/ai-story-runtime-client";
import {
  PRODUCT_RUNTIME_POLL_INTERVAL_MS,
  canShowExecuteButton,
  shouldPollProductRuntime,
} from "@/lib/ai-story-runtime-ui";

type Props = {
  campaignId: string;
  storyId: string;
  executionPlanId: string;
  workspaceRole: WorkspaceRole | string | null;
};

const INITIAL_SERVER_READ_ATTEMPTS = 3;
const INITIAL_SERVER_READ_RETRY_MS = 750;

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

  const clearPoll = useCallback(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const refresh = useCallback(async () => {
    const gen = ++requestGen.current;
    try {
      const next = await getProductRuntimeProjection({
        campaignId,
        storyId,
        executionPlanId,
      });
      if (gen !== requestGen.current) return next;
      setProjection(next);
      setError(null);
      return next;
    } catch (err) {
      if (gen !== requestGen.current) return null;
      setError(
        err instanceof StoryRuntimeClientError
          ? `${err.message}${err.requestCorrelationId ? ` (reference ${err.requestCorrelationId})` : ""}`
          : err instanceof Error
            ? err.message
            : "Story review could not be loaded."
      );
      return null;
    } finally {
      if (gen === requestGen.current) setLoading(false);
    }
  }, [campaignId, storyId, executionPlanId]);

  const ensurePolling = useCallback(
    (status: ProductRuntimeProjection["status"] | undefined) => {
      clearPoll();
      if (!shouldPollProductRuntime(status)) return;
      pollTimer.current = setInterval(() => {
        void refresh();
      }, PRODUCT_RUNTIME_POLL_INTERVAL_MS);
    },
    [clearPoll, refresh]
  );

  useEffect(() => {
    setLoading(true);
    void (async () => {
      let next: ProductRuntimeProjection | null = null;
      for (let attempt = 1; attempt <= INITIAL_SERVER_READ_ATTEMPTS; attempt += 1) {
        next = await refresh();
        if (next || attempt === INITIAL_SERVER_READ_ATTEMPTS) break;
        await new Promise((resolve) => setTimeout(resolve, INITIAL_SERVER_READ_RETRY_MS));
      }
      ensurePolling(next?.status);
    })();
    return () => {
      requestGen.current += 1;
      clearPoll();
    };
  }, [refresh, ensurePolling, clearPoll]);

  useEffect(() => {
    ensurePolling(projection?.status);
  }, [projection?.status, ensurePolling]);

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
      ensurePolling(next?.status ?? "AUTHORIZED");
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

  async function onReleaseRemaining() {
    if (!projection?.remainingReleasePermitted || releasing) return;
    setReleasing(true); setError(null);
    try {
      await postReleaseRemainingScenes({ campaignId, storyId, executionPlanId });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Release remaining scenes failed");
    } finally { setReleasing(false); }
  }

  const statusLabel = t(statusKey(projection?.status));
  const canExecute =
    showExecuteChrome && Boolean(projection?.canExecute) && !executing && !loading;

  return (
    <div className="space-y-4" data-testid="story-runtime-panel">
      <section className="space-y-4 rounded-2xl border border-border bg-white p-5">
        <div>
          <h2 className="text-lg font-bold text-navy">{t("aiStory.runtime.title")}</h2>
          <p className="mt-1 text-sm text-ink-secondary">
            {t("aiStory.runtime.subtitle")}
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
              {projection.reconciliationCount > 0
                ? ` · ${projection.reconciliationCount} reconciliation`
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
                : t("aiStory.runtime.execute")}
            </button>
            {projection?.remainingReleasePermitted ? (
              <button type="button" disabled={releasing} onClick={() => void onReleaseRemaining()}
                className="brand-btn-primary" data-testid="release-remaining-scenes">
                {releasing ? "Releasing…" : "Release remaining scenes"}
              </button>
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-ink-secondary" data-testid="viewer-execute-hidden">
            {t("aiStory.runtime.viewerReadonly")}
          </p>
        )}

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
              ? `${projection.heldSceneCount} remaining scene(s) ready for operator release`
              : `${projection?.heldSceneCount} scene(s) waiting for first-scene approval`}
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
              onClick={() => void refresh()}
              disabled={loading}
              data-testid="story-runtime-read-retry"
            >
              Retry loading review
            </button>
          </div>
        ) : null}
      </section>

      <GeneratedSceneReviewPanel
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
