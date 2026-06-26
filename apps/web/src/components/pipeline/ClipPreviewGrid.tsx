"use client";

import Link from "next/link";
import { useState } from "react";
import { useI18n } from "@/lib/i18n/provider";
import { StatusBadge } from "@/components/AppShell";
import { extractClipMeta, formatClipDuration, formatPlatformLabel, videoUrlWithCacheBust } from "@/lib/clip-utils";
import { scoreLetterGrade } from "@/lib/score-utils";
import { ClipAudioControls } from "@/components/pipeline/ClipAudioControls";
import { ClipDownloadMenu } from "@/components/pipeline/ClipDownloadMenu";
import { MusicMatchPanel } from "@/components/pipeline/MusicMatchPanel";
import type { EditPlan } from "@ceo-agent/shared";

function clipStatus(creative: Record<string, unknown> | undefined): string {
  if (!creative) return "pending";
  if (creative.videoUrl) return "preview_ready";
  const renderStatus = creative.renderStatus as string | undefined;
  const progress = creative.renderProgress as { error?: string } | undefined;
  if (creative.status === "failed" || progress?.error) return "failed";
  if (renderStatus === "preview_rendering") return "preview_rendering";
  return "queued";
}

export function ClipPreviewGrid({
  slug,
  creatives,
}: {
  slug: string;
  creatives: Array<Record<string, unknown>>;
}) {
  const { t } = useI18n();
  const [retrying, setRetrying] = useState<string | null>(null);
  // After an in-card audio re-render finishes, the parent poll may have stopped
  // (task already completed). Keep a local override so the new video shows.
  const [overrides, setOverrides] = useState<Record<string, Record<string, unknown>>>({});
  const merged = creatives.map((c) => {
    const id = c?.id as string | undefined;
    return id && overrides[id] ? { ...c, ...overrides[id] } : c;
  });
  const ready = merged.filter((c) => c.videoUrl).length;
  const failed = merged.filter((c) => clipStatus(c) === "failed").length;

  async function refreshClip(creativeId: string) {
    try {
      const res = await fetch(`/api/creatives/${creativeId}`);
      const data = await res.json();
      if (data.creative) {
        setOverrides((prev) => ({ ...prev, [creativeId]: data.creative }));
      }
    } catch {
      // ignore
    }
  }

  async function retryClip(creativeId: string) {
    setRetrying(creativeId);
    try {
      await fetch(`/api/creatives/${creativeId}/retry-render`, { method: "POST" });
    } finally {
      setRetrying(null);
    }
  }

  return (
    <section className="mt-8">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-navy">{t("pipeline.clipsResultsTitle")}</h2>
          <p className="mt-1 text-sm text-ink-secondary">
            {failed > 0
              ? t("pipeline.clipsProgressFailed", {
                  ready: String(ready),
                  total: "3",
                  failed: String(failed),
                })
              : ready < 3
                ? t("pipeline.clipsGenerating", { ready: String(ready), total: "3" })
                : t("pipeline.clipsSubtitle", { ready: String(ready), total: "3" })}
          </p>
        </div>
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => {
          const c = merged[index];
          const id = c?.id as string | undefined;
          const videoUrl = c?.videoUrl as string | undefined;
          const meta = extractClipMeta(c);
          const status = clipStatus(c);
          const progress = c?.renderProgress as { error?: string } | undefined;

          return (
            <div
              key={id ?? `slot-${index}`}
              className="brand-card overflow-hidden transition-shadow duration-200 hover:shadow-elevated"
            >
              {videoUrl ? (
                <video
                  key={String(c?.updatedAt ?? id)}
                  src={videoUrlWithCacheBust(
                    videoUrl,
                    c?.updatedAt as string | undefined
                  )}
                  controls
                  className="aspect-[9/16] w-full bg-navy object-contain"
                />
              ) : (
                <div className="flex aspect-[9/16] flex-col items-center justify-center gap-2 bg-surface-muted px-4 text-center text-ink-secondary">
                  {status === "preview_rendering" ? (
                    <>
                      <svg className="h-8 w-8 animate-spin text-brand-blue" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      <span className="text-xs">{t("pipeline.status.running")}</span>
                    </>
                  ) : status === "failed" ? (
                    <>
                      <span className="text-xs font-medium text-red-600">{t("pipeline.clipFailed")}</span>
                      {progress?.error && (
                        <span className="line-clamp-3 text-[10px] text-red-500">{progress.error}</span>
                      )}
                    </>
                  ) : (
                    <span className="text-xs">{c ? t("pipeline.clipWaiting") : t("pipeline.clipQueued")}</span>
                  )}
                </div>
              )}

              <div className="space-y-3 p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-navy">
                    {meta.clipTitle ?? t("pipeline.clipN", { n: String(index + 1) })}
                  </p>
                  <StatusBadge status={status} />
                </div>

                <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                  <div>
                    <dt className="text-ink-secondary">{t("pipeline.clip.duration")}</dt>
                    <dd className="mt-0.5 font-medium tabular-nums text-ink">
                      {formatClipDuration(meta.durationSec)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink-secondary">{t("pipeline.clip.score")}</dt>
                    <dd className="mt-0.5 font-medium text-brand-amber">
                      {meta.score != null ? (
                        <>
                          {scoreLetterGrade(meta.score)}{" "}
                          <span className="text-ink-secondary">({meta.score})</span>
                        </>
                      ) : (
                        "—"
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink-secondary">{t("pipeline.clip.hookType")}</dt>
                    <dd className="mt-0.5 font-medium capitalize text-ink">{meta.hookType ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-secondary">{t("pipeline.clip.platform")}</dt>
                    <dd className="mt-0.5 font-medium text-ink">{formatPlatformLabel(meta.platform)}</dd>
                  </div>
                </dl>

                {status === "failed" && id && (
                  <button
                    type="button"
                    disabled={retrying === id}
                    onClick={() => retryClip(id)}
                    className="w-full rounded-lg border border-border bg-surface py-2 text-xs font-medium text-navy transition hover:border-brand-blue/40 disabled:opacity-60"
                  >
                    {retrying === id ? t("pipeline.retrying") : t("pipeline.retryClip")}
                  </button>
                )}

                {videoUrl && id && (
                  <>
                    <MusicMatchPanel editPlan={c?.editPlan as EditPlan | undefined} compact />
                    <ClipAudioControls
                      creativeId={id}
                      editPlan={c?.editPlan as EditPlan | undefined}
                      renderStatus={c?.renderStatus as string | undefined}
                      renderProgress={c?.renderProgress as { percent?: number; phase?: string; error?: string } | undefined}
                      onRenderComplete={() => refreshClip(id)}
                      compact
                    />
                    <ClipDownloadMenu
                      creativeId={id}
                      clipLabel={meta.clipTitle ?? `clip_${index + 1}`}
                      compact
                    />
                    <Link
                      href={`/w/${slug}/creatives/${id}`}
                      className="block text-center text-xs font-medium text-brand-blue transition hover:text-brand-blue/80"
                    >
                      {t("pipeline.viewClipDetails")}
                    </Link>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
