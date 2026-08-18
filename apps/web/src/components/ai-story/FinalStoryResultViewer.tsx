"use client";

/**
 * Sprint 3 PR 3.7 Phase E — Final Story Result video viewer.
 * Consumes only the FSR read API playback URL (accepted FSR required).
 */
import { useEffect, useState } from "react";
import type { FinalStoryResultReadModel } from "@ceo-agent/shared";
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
};

export function FinalStoryResultViewer({
  campaignId,
  storyId,
  executionPlanId,
  enabled,
}: Props) {
  const { t } = useI18n();
  const [model, setModel] = useState<FinalStoryResultReadModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

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

  useEffect(() => {
    if (!enabled) {
      setModel(null);
      setError(null);
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
        if (!cancelled) setModel(next);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof StoryRuntimeClientError && err.status === 404) {
          setModel(null);
          setError(null);
          return;
        }
        setError(err instanceof Error ? err.message : "Failed to load final video");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, campaignId, storyId, executionPlanId]);

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
      </div>
      {loading ? (
        <p className="text-sm text-ink-secondary" data-testid="final-story-loading">
          {t("aiStory.runtime.finalVideoLoading")}
        </p>
      ) : null}
      {error ? (
        <p className="text-sm text-red-700" data-testid="final-story-error">
          {error}
        </p>
      ) : null}
      {model?.playbackUrl ? (
        <>
          <video key={model.playbackUrl} controls playsInline className="w-full max-h-[480px] rounded-lg bg-black" src={model.playbackUrl} data-testid="final-story-video">
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
          {t("aiStory.runtime.finalVideoAbsent")}
        </p>
      ) : null}
    </section>
  );
}
