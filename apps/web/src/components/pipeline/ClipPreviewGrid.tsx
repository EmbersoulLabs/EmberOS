"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/provider";
import { StatusBadge } from "@/components/AppShell";
import { extractClipMeta, formatClipDuration, formatPlatformLabel, videoUrlWithCacheBust } from "@/lib/clip-utils";
import { scoreLetterGrade } from "@/lib/score-utils";
import { ClipAudioControls } from "@/components/pipeline/ClipAudioControls";
import { ClipDownloadMenu } from "@/components/pipeline/ClipDownloadMenu";
import { MusicMatchPanel } from "@/components/pipeline/MusicMatchPanel";
import type { EditPlan } from "@ceo-agent/shared";
import {
  previewArtifactIdentity,
  recordPreviewDeliveryFailure,
  recordPreviewDeliverySuccess,
  recordPreviewRefreshFailure,
  type PreviewDeliveryState,
} from "@/lib/bounded-preview-delivery";
import { resolveCreativeRecoveryPollDecision } from "@/lib/video-studio-result-state";

const CREATIVE_RECOVERY_POLL_MS = 3000;
const MAX_CREATIVE_RECOVERY_POLLS = 60;

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
  onPreviewDeliveryErrorChange,
}: {
  slug: string;
  creatives: Array<Record<string, unknown>>;
  onPreviewDeliveryErrorChange?: (creativeId: string, active: boolean) => void;
}) {
  const { t } = useI18n();
  const [retrying, setRetrying] = useState<string | null>(null);
  const [recoveryErrors, setRecoveryErrors] = useState<Record<string, string>>({});
  const recoveryTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // After an in-card audio re-render finishes, the parent poll may have stopped
  // (task already completed). Keep a local override so the new video shows.
  const [overrides, setOverrides] = useState<Record<string, Record<string, unknown>>>({});
  const previewDelivery = useRef<Record<string, PreviewDeliveryState>>({});
  const [, setDeliveryRevision] = useState(0);
  const merged = creatives.map((c) => {
    const id = c?.id as string | undefined;
    return id && overrides[id] ? { ...c, ...overrides[id] } : c;
  });
  const ready = merged.filter((c) => c.videoUrl).length;
  const failed = merged.filter((c) => clipStatus(c) === "failed").length;

  useEffect(() => () => {
    Object.values(recoveryTimers.current).forEach(clearTimeout);
  }, []);

  async function loadClip(creativeId: string): Promise<Record<string, unknown> | null> {
    try {
      const res = await fetch(`/api/creatives/${creativeId}`);
      if (!res.ok) return null;
      const data = await res.json();
      if (data.creative) {
        setOverrides((prev) => ({ ...prev, [creativeId]: data.creative }));
        return data.creative as Record<string, unknown>;
      }
    } catch {
      // ignore
    }
    return null;
  }

  async function refreshClip(creativeId: string): Promise<boolean> {
    return Boolean(await loadClip(creativeId));
  }

  async function handlePreviewError(creative: Record<string, unknown>, creativeId: string) {
    const identity = previewArtifactIdentity(creative);
    const transition = recordPreviewDeliveryFailure(previewDelivery.current[creativeId], identity);
    previewDelivery.current[creativeId] = transition.state;
    onPreviewDeliveryErrorChange?.(
      creativeId,
      transition.state.status === "TERMINAL_PREVIEW_ERROR"
    );
    setDeliveryRevision((value) => value + 1);
    if (!transition.shouldRefresh) return;
    if (!(await refreshClip(creativeId))) {
      previewDelivery.current[creativeId] = recordPreviewRefreshFailure(
        previewDelivery.current[creativeId]!,
        identity
      );
      onPreviewDeliveryErrorChange?.(creativeId, true);
      setDeliveryRevision((value) => value + 1);
    }
  }

  async function retryClip(creativeId: string) {
    setRetrying(creativeId);
    setRecoveryErrors((previous) => ({ ...previous, [creativeId]: "" }));
    try {
      const response = await fetch(`/api/creatives/${creativeId}/retry-render`, { method: "POST" });
      if (!response.ok) {
        setRecoveryErrors((previous) => ({
          ...previous,
          [creativeId]: t("pipeline.retryRenderRejected"),
        }));
        setRetrying(null);
        return;
      }
      const persisted = await loadClip(creativeId);
      if (!persisted) {
        setRecoveryErrors((previous) => ({
          ...previous,
          [creativeId]: t("pipeline.retryRenderStatusUnavailable"),
        }));
      }

      let polls = 0;
      const pollCreative = async () => {
        polls += 1;
        const creative = (await loadClip(creativeId)) ?? undefined;
        const decision = resolveCreativeRecoveryPollDecision(creative, polls, MAX_CREATIVE_RECOVERY_POLLS);
        if (decision === "READY") {
          setRetrying(null);
          return;
        }
        if (decision === "FAILED") {
          setRetrying(null);
          setRecoveryErrors((previous) => ({
            ...previous,
            [creativeId]: t("pipeline.retryRenderFailed"),
          }));
          return;
        }
        if (decision === "PAUSE_ACTIVE") {
          setRetrying(null);
          setRecoveryErrors((previous) => ({
            ...previous,
            [creativeId]: t("pipeline.retryRenderStillProcessing"),
          }));
          return;
        }
        recoveryTimers.current[creativeId] = setTimeout(pollCreative, CREATIVE_RECOVERY_POLL_MS);
      };
      recoveryTimers.current[creativeId] = setTimeout(pollCreative, CREATIVE_RECOVERY_POLL_MS);
    } catch {
      setRecoveryErrors((previous) => ({
        ...previous,
        [creativeId]: t("pipeline.retryRenderRejected"),
      }));
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
          const artifactIdentity = previewArtifactIdentity(c);
          const deliveryState = id ? previewDelivery.current[id] : undefined;
          const terminalPreviewError =
            deliveryState?.artifactIdentity === artifactIdentity &&
            deliveryState.status === "TERMINAL_PREVIEW_ERROR";

          return (
            <div
              key={id ?? `slot-${index}`}
              className="brand-card overflow-hidden transition-shadow duration-200 hover:shadow-elevated"
            >
              {videoUrl && !terminalPreviewError ? (
                <video
                  key={String(c?.updatedAt ?? id)}
                  src={videoUrlWithCacheBust(
                    videoUrl,
                    c?.updatedAt as string | undefined
                  )}
                  controls
                  onError={() => id && c && void handlePreviewError(c, id)}
                  onLoadedData={() => {
                    if (!id) return;
                    previewDelivery.current[id] = recordPreviewDeliverySuccess(
                      previewDelivery.current[id],
                      artifactIdentity
                    );
                    onPreviewDeliveryErrorChange?.(id, false);
                  }}
                  className="aspect-[9/16] w-full bg-navy object-contain"
                />
              ) : (
                <div className="flex aspect-[9/16] flex-col items-center justify-center gap-2 bg-surface-muted px-4 text-center text-ink-secondary">
                  {terminalPreviewError ? (
                    <span className="text-xs font-medium text-red-600">
                      Preview could not be loaded.
                    </span>
                  ) : status === "preview_rendering" ? (
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
                      <span className="text-[10px] text-red-500">{t("pipeline.clipRenderSafeError")}</span>
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
                {id && recoveryErrors[id] && (
                  <p className="text-xs text-red-600" role="alert">{recoveryErrors[id]}</p>
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
