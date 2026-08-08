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
        <video
          key={model.playbackUrl}
          controls
          playsInline
          className="w-full max-h-[480px] rounded-lg bg-black"
          src={model.playbackUrl}
          data-testid="final-story-video"
        >
          <track kind="captions" />
        </video>
      ) : !loading && !error ? (
        <p className="text-sm text-ink-secondary" data-testid="final-story-absent">
          {t("aiStory.runtime.finalVideoAbsent")}
        </p>
      ) : null}
    </section>
  );
}
