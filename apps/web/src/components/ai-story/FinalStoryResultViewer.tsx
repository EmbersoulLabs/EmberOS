"use client";

/**
 * Sprint 3 PR 3.7 Phase E — Final Story Result video viewer.
 * Consumes only the FSR read API playback URL (accepted FSR required).
 */
import { useCallback, useEffect, useState } from "react";
import type { FinalStoryResultReadModel } from "@ceo-agent/shared";
import { resolveEpisodeDurationLabel } from "@ceo-agent/shared";
import { useI18n } from "@/lib/i18n/provider";
import {
  StoryRuntimeClientError,
  createFinalStoryDownload,
  getFinalStoryResultReadModel,
} from "@/lib/ai-story-runtime-client";

type Props = {
  campaignId: string;
  storyId: string;
  executionPlanId: string;
  enabled: boolean;
  expectAcceptedResult?: boolean;
  onDurationMs?: (durationMs: number | null) => void;
};

export function FinalStoryResultViewer({
  campaignId,
  storyId,
  executionPlanId,
  enabled,
  expectAcceptedResult = false,
  onDurationMs,
}: Props) {
  const { t } = useI18n();
  const [model, setModel] = useState<FinalStoryResultReadModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [mediaPhase, setMediaPhase] = useState<"idle" | "loading" | "ready" | "error">("idle");

  async function downloadFinalVideo() {
    setDownloadLoading(true);
    setDownloadError(null);
    try {
      const delivery = await createFinalStoryDownload({ campaignId, storyId, executionPlanId });
      const link = document.createElement("a");
      link.href = delivery.downloadUrl;
      link.download = delivery.filename;
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch {
      setDownloadError(t("aiStory.runtime.downloadError"));
    } finally {
      setDownloadLoading(false);
    }
  }

  const reportDuration = useCallback(
    (durationMs: number | null) => {
      onDurationMs?.(durationMs);
    },
    [onDurationMs]
  );

  useEffect(() => {
    if (!enabled) {
      setModel(null);
      setError(null);
      reportDuration(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const next = await getFinalStoryResultReadModel({
          campaignId,
          storyId,
          executionPlanId,
        });
        if (!cancelled) {
          setModel(next);
          reportDuration(next.durationMs ?? null);
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof StoryRuntimeClientError && err.status === 404 && !expectAcceptedResult) {
          setModel(null);
          setError(null);
          reportDuration(null);
          return;
        }
        setModel(null);
        setError(t("aiStory.runtime.finalVideoTemporarilyUnavailable"));
        reportDuration(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, expectAcceptedResult, campaignId, storyId, executionPlanId, reloadToken, reportDuration, t]);

  if (!enabled) return null;

  return (
    <section
      className="space-y-3 rounded-2xl border border-border bg-white p-5"
      data-testid="final-story-result-viewer"
    >
      <div>
        <h3 className="text-base font-bold text-navy">
          {t("aiStory.runtime.finalVideoTitle")}
        </h3>
        <p className="mt-1 text-sm text-ink-secondary">
          {t("aiStory.runtime.finalVideoSubtitle")}
        </p>
        {model ? (
          <p className="mt-1 text-sm text-navy" data-testid="final-story-duration">
            {resolveEpisodeDurationLabel(model.durationMs ?? null, { expected: true })}
          </p>
        ) : null}
        {model?.qcProvenance ? (
          <p
            className="mt-1 text-xs text-ink-secondary"
            data-testid="final-story-qc-provenance"
          >
            {t("aiStory.runtime.finalVideoQcProvenance")}
          </p>
        ) : null}
      </div>
      {loading ? (
        <p className="flex items-center gap-2 text-sm text-ink-secondary" role="status" aria-live="polite" data-testid="final-story-loading">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-navy/20 border-t-navy" aria-hidden="true" />
          {t("aiStory.runtime.finalVideoLoading")}
        </p>
      ) : null}
      {error ? (
        <div className="space-y-2" data-testid="final-story-error">
          <p className="text-sm text-red-700">{error}</p>
          <button
            type="button"
            className="text-sm font-semibold text-navy underline"
            onClick={() => setReloadToken((current) => current + 1)}
            data-testid="final-story-read-retry"
          >
            {t("aiStory.runtime.downloadRetry")}
          </button>
        </div>
      ) : null}
      {model?.playbackUrl ? (
        <>
          <p className="text-sm font-medium text-navy" role="status" data-testid="final-story-ready">Your episode is ready!</p>
          {mediaPhase === "loading" ? (
            <p className="flex items-center gap-2 text-sm text-ink-secondary" role="status" aria-live="polite" data-testid="final-story-media-loading">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-navy/20 border-t-navy" aria-hidden="true" />
              {t("aiStory.runtime.finalVideoLoading")}
            </p>
          ) : null}
          {mediaPhase === "error" ? (
            <p className="text-sm text-red-700" role="alert" data-testid="final-story-media-error">{t("aiStory.runtime.finalVideoTemporarilyUnavailable")}</p>
          ) : null}
          <video key={model.playbackUrl} controls playsInline className="aspect-[9/16] w-full max-h-[70vh] rounded-lg bg-black md:aspect-video" src={model.playbackUrl} data-testid="final-story-video" onLoadStart={() => setMediaPhase("loading")} onCanPlay={() => setMediaPhase("ready")} onError={() => setMediaPhase("error")}>
            <track kind="captions" />
          </video>
          <div className="space-y-2">
            <button type="button" className="rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white disabled:cursor-wait disabled:opacity-60" disabled={downloadLoading} onClick={() => void downloadFinalVideo()} data-testid="final-story-download">
              {downloadLoading ? t("aiStory.runtime.downloadPreparing") : t("aiStory.runtime.downloadVideo")}
            </button>
            {downloadError ? (
              <div className="flex items-center gap-3" role="alert" data-testid="final-story-download-error">
                <p className="text-sm text-red-700">{downloadError}</p>
                <button type="button" className="text-sm font-semibold text-navy underline" onClick={() => void downloadFinalVideo()}>{t("aiStory.runtime.downloadRetry")}</button>
              </div>
            ) : null}
          </div>
        </>
      ) : !loading && !error ? (
        <p className="text-sm text-ink-secondary" data-testid="final-story-absent">
          {expectAcceptedResult
            ? t("aiStory.runtime.finalVideoTemporarilyUnavailable")
            : t("aiStory.runtime.finalVideoAbsent")}
        </p>
      ) : null}
    </section>
  );
}
