"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { CampaignPageHeader } from "@/components/pipeline/CampaignPageHeader";
import { RunCeoButton } from "@/components/RunCeoButton";
import { isCampaignDeletable } from "@/lib/campaigns";
import { useI18n } from "@/lib/i18n/provider";
import {
  AGENCY_STEPS,
  AUTO_CLIP_STEPS,
  AGENCY_PIPELINE_PHASES,
  AUTO_CLIP_PIPELINE_PHASES,
  computePipelineProgress,
  isAutoClipTask,
} from "@/lib/pipeline-config";
import { PipelineHero } from "@/components/pipeline/PipelineHero";
import { PipelinePhases } from "@/components/pipeline/PipelinePhases";
import {
  PipelineLoadingState,
  PipelineEmptyState,
  PipelineErrorBanner,
} from "@/components/pipeline/PipelineStates";
import { ClipPreviewGrid } from "@/components/pipeline/ClipPreviewGrid";
import { CopyDownloadButtons } from "@/components/pipeline/CopyDownloadButtons";
import { SingleCreativePreview } from "@/components/pipeline/SingleCreativePreview";
import { MarketingScorePanel } from "@/components/pipeline/MarketingScorePanel";
import { MarketingPackagePanel } from "@/components/pipeline/MarketingPackagePanel";
import type { MarketingContentPackage } from "@ceo-agent/shared";

export default function TaskProgressContent() {
  const params = useParams();
  const router = useRouter();
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const slug = params.slug as string;
  const campaignId = params.id as string;
  const taskIdParam = searchParams.get("taskId");

  const [task, setTask] = useState<Record<string, unknown> | null>(null);
  const [creativeId, setCreativeId] = useState<string | null>(null);
  const [creatives, setCreatives] = useState<Array<Record<string, unknown>>>([]);
  const [exportPackUrl, setExportPackUrl] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportResolution, setExportResolution] = useState<"720p" | "1080p" | "2k">("720p");
  const [canExport1080p, setCanExport1080p] = useState(true);
  const [canExport2k, setCanExport2k] = useState(true);
  const [exportPaywallEnabled, setExportPaywallEnabled] = useState(false);
  const [exportStatus, setExportStatus] = useState<string>("none");
  const [exportedResolution, setExportedResolution] = useState<string | null>(null);
  const [canExport, setCanExport] = useState(false);
  const [exportError, setExportError] = useState("");
  const [finalRenderProgress, setFinalRenderProgress] = useState<{
    finalReady: number;
    total: number;
    finalRendering: number;
  } | null>(null);
  const [rendition2kProgress, setRendition2kProgress] = useState<{
    ready: number;
    total: number;
    rendering: number;
  } | null>(null);
  const [campaignStatus, setCampaignStatus] = useState<string | null>(null);
  const [campaignName, setCampaignName] = useState<string | null>(null);
  const [canDelete, setCanDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [pollError, setPollError] = useState("");
  const [initialLoad, setInitialLoad] = useState(true);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;

    async function poll() {
      try {
        const campRes = await fetch(`/api/campaigns/${campaignId}`);
        if (!campRes.ok) {
          const errBody = await campRes.json().catch(() => ({}));
          throw new Error(
            (errBody as { error?: string }).error ??
              `Failed to load campaign (${campRes.status})`
          );
        }
        const campData = await campRes.json();
        setPollError("");
        const taskId = taskIdParam ?? campData.task?.id;
        const campStatus = campData.campaign?.status as string | undefined;
        const campName = campData.campaign?.name as string | undefined;
        if (campStatus) setCampaignStatus(campStatus);
        if (campName) setCampaignName(campName);
        setCanDelete(
          (campData.canDelete as boolean | undefined) ??
            (campStatus
              ? isCampaignDeletable(
                  campStatus,
                  campData.task?.status as string,
                  (campData.task?.stepProgress as Record<string, { status?: string }>) ?? null
                )
              : false)
        );
        if (!taskId) {
          setInitialLoad(false);
          return;
        }

        const res = await fetch(`/api/tasks/${taskId}`);
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(
            (errBody as { error?: string }).error ?? `Failed to load task (${res.status})`
          );
        }
        const data = await res.json();
        setTask(data.task);
        if (data.creative?.id) setCreativeId(data.creative.id);
        if (Array.isArray(data.creatives)) {
          setCreatives(data.creatives as Array<Record<string, unknown>>);
          if (data.creatives.length > 0 && !data.creative?.id) {
            setCreativeId((data.creatives[0] as { id?: string }).id ?? null);
          }
        }

        const exportStep = (
          data.task?.stepProgress as Record<string, { output?: { exportPackUrl?: string; resolution?: string } }>
        )?.export_pack;
        if (exportStep?.output?.exportPackUrl) {
          setExportPackUrl(exportStep.output.exportPackUrl);
          if (exportStep.output.resolution) setExportedResolution(exportStep.output.resolution);
        }

        const clipCount = Array.isArray(data.creatives) ? data.creatives.length : 0;
        const allPreviewsReady =
          clipCount >= 3 &&
          (data.creatives as Array<{ renderStatus?: string; videoUrl?: string }>).every(
            (c) => c.renderStatus === "preview_ready" && Boolean(c.videoUrl)
          );
        let keepPolling = data.task?.status !== "completed" && data.task?.status !== "failed";

        const anyClipRendering =
          Array.isArray(data.creatives) &&
          (data.creatives as Array<{ renderStatus?: string; renderProgress?: { rendition?: string; phase?: string } }>).some(
            (c) =>
              c.renderStatus === "preview_rendering" ||
              c.renderStatus === "final_rendering" ||
              (c.renderProgress?.rendition === "2k" &&
                c.renderProgress.phase !== "done")
          );
        if (anyClipRendering) keepPolling = true;

        if (allPreviewsReady) {
          const exportRes = await fetch(`/api/tasks/${taskId}/export`);
          if (exportRes.ok) {
            const exportData = await exportRes.json();
            setCanExport1080p(Boolean(exportData.canExport1080p));
            setCanExport2k(Boolean(exportData.canExport2k));
            setExportPaywallEnabled(Boolean(exportData.exportPaywallEnabled));
            setCanExport(Boolean(exportData.canExport));
            setExportStatus(exportData.status ?? "none");
            if (exportData.exportPackUrl) setExportPackUrl(exportData.exportPackUrl);
            if (exportData.exportedResolution) setExportedResolution(exportData.exportedResolution);
            if (exportData.finalRenderProgress) {
              setFinalRenderProgress(exportData.finalRenderProgress);
            }
            if (exportData.rendition2kProgress) {
              setRendition2kProgress(exportData.rendition2kProgress);
            }
            if (
              exportData.status === "final_rendering" ||
              exportData.status === "export_pending"
            ) {
              keepPolling = true;
            }
          }
        }

        const latestCampStatus = (campData.campaign?.status as string | undefined) ?? campStatus;
        setCanDelete(
          (campData.canDelete as boolean | undefined) ??
            (latestCampStatus
              ? isCampaignDeletable(
                  latestCampStatus,
                  data.task?.status as string,
                  (data.task?.stepProgress as Record<string, { status?: string }>) ?? null
                )
              : false)
        );

        if (!keepPolling && (data.task?.status === "completed" || data.task?.status === "failed")) {
          if (interval) clearInterval(interval);
        }
        setInitialLoad(false);
      } catch (err) {
        setPollError(err instanceof Error ? err.message : "Failed to load progress");
        setInitialLoad(false);
        if (interval) clearInterval(interval);
      }
    }

    poll();
    interval = setInterval(poll, 3000);
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [campaignId, taskIdParam]);

  const progress = (task?.stepProgress ?? {}) as Record<
    string,
    {
      status: string;
      error?: string;
      output?: unknown;
      percent?: number;
      phase?: string;
    }
  >;
  const taskError = task?.errorMessage as string | undefined;
  const taskStatus = task?.status as string | undefined;
  const isAutoClip = isAutoClipTask(progress, creatives.length);
  const steps = isAutoClip ? AUTO_CLIP_STEPS : AGENCY_STEPS;
  const phases = isAutoClip ? AUTO_CLIP_PIPELINE_PHASES : AGENCY_PIPELINE_PHASES;
  const marketingScore =
    progress.marketing_score?.status === "completed"
      ? (progress.marketing_score.output as Record<string, unknown> | undefined)
      : undefined;
  const contentPackage =
    progress.content_generate?.status === "completed"
      ? (progress.content_generate.output as MarketingContentPackage | undefined)
      : undefined;
  const primaryCreative = creatives[0];
  const readyClipCount = creatives.filter((c) => c.videoUrl).length;
  const hasCopy = creatives.some(
    (c) => Array.isArray(c.copyVariants) && (c.copyVariants as unknown[]).length > 0
  );
  const activeTaskId = (task?.id as string | undefined) ?? taskIdParam ?? undefined;
  const allClipsPreviewReady =
    creatives.length >= 3 &&
    creatives.every(
      (c) => c.renderStatus === "preview_ready" && Boolean(c.videoUrl)
    );
  const exportZipReady =
    Boolean(exportPackUrl) &&
    exportStatus === "ready" &&
    exportedResolution === exportResolution;
  const { percent, currentStep, currentStepIndex, videoReady } = computePipelineProgress(
    progress,
    taskStatus,
    steps
  );
  const showDelete =
    canDelete ||
    taskStatus === "failed" ||
    steps.some((step) => progress[step]?.status === "failed") ||
    (campaignStatus ? isCampaignDeletable(campaignStatus, taskStatus, progress) : false);

  async function deleteCampaign() {
    setDeleteError("");
    if (!confirm(t("campaigns.deleteCampaignConfirm"))) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}`, { method: "DELETE" });
      const body = await res.json();
      if (!res.ok) {
        setDeleteError(body.error ?? t("error.deleteCampaign"));
        return;
      }
      router.push(`/w/${slug}/campaigns`);
    } finally {
      setDeleting(false);
    }
  }

  async function refreshExportStatus(taskId: string) {
    const exportRes = await fetch(`/api/tasks/${taskId}/export`);
    if (!exportRes.ok) return;
    const exportData = await exportRes.json();
    setCanExport1080p(Boolean(exportData.canExport1080p));
    setCanExport2k(Boolean(exportData.canExport2k));
    setExportPaywallEnabled(Boolean(exportData.exportPaywallEnabled));
    setCanExport(Boolean(exportData.canExport));
    setExportStatus(exportData.status ?? "none");
    if (exportData.exportPackUrl) setExportPackUrl(exportData.exportPackUrl);
    if (exportData.exportedResolution) setExportedResolution(exportData.exportedResolution);
    if (exportData.finalRenderProgress) setFinalRenderProgress(exportData.finalRenderProgress);
    if (exportData.rendition2kProgress) setRendition2kProgress(exportData.rendition2kProgress);
  }

  async function exportAllClips() {
    const taskId = taskIdParam ?? (task?.id as string | undefined);
    if (!taskId) {
      setExportError(t("export.failed"));
      return;
    }
    setExporting(true);
    setExportError("");
    try {
      const res = await fetch(`/api/tasks/${taskId}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolution: exportResolution }),
      });
      const body = await res.json();
      if (!res.ok) {
        setExportError(body.error ?? t("export.failed"));
        return;
      }
      if (body.status === "final_rendering") {
        setExportStatus("final_rendering");
        setCanExport(false);
        if (body.finalRenderProgress) setFinalRenderProgress(body.finalRenderProgress);
        if (body.rendition2kProgress) setRendition2kProgress(body.rendition2kProgress);
      } else if (body.status === "export_pending") {
        setExportStatus("export_pending");
        setCanExport(false);
      }
      await refreshExportStatus(taskId);
    } catch {
      setExportError(t("export.failed"));
    } finally {
      setExporting(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl">
        <div className="mb-2 flex flex-wrap items-start justify-between gap-4">
          {task ? (
            <div className="min-w-0 flex-1">
              <CampaignPageHeader
                campaignName={campaignName ?? undefined}
                taskStatus={taskStatus}
                readyClips={isAutoClip ? readyClipCount : undefined}
              />
            </div>
          ) : (
            <CampaignPageHeader />
          )}
          {showDelete && (
            <button
              type="button"
              disabled={deleting}
              onClick={deleteCampaign}
              className="shrink-0 rounded-xl border border-border bg-surface px-4 py-2 text-sm font-medium text-ink-secondary shadow-sm transition hover:border-red-200 hover:text-red-600 disabled:opacity-60"
            >
              {deleting ? t("campaigns.deleting") : t("campaigns.deleteCampaign")}
            </button>
          )}
        </div>

        {deleteError && <PipelineErrorBanner message={deleteError} />}

        {pollError && (
          <div className="mb-6">
            <PipelineErrorBanner message={pollError} />
          </div>
        )}

        {initialLoad && !task && <PipelineLoadingState />}

        {!initialLoad && !task && !pollError && (
          <PipelineEmptyState onBackHref={`/w/${slug}/campaigns`} />
        )}

        {task && (
          <>
            <PipelineHero
              percent={percent}
              currentStep={currentStep}
              currentStepIndex={currentStepIndex}
              totalSteps={steps.length}
              taskStatus={taskStatus}
            />

            {taskError && (
              <div className="mt-4">
                <PipelineErrorBanner message={taskError} />
              </div>
            )}

            {isAutoClip && <ClipPreviewGrid slug={slug} creatives={creatives} />}

            {contentPackage && <MarketingPackagePanel contentPackage={contentPackage} />}

            {hasCopy && activeTaskId && !contentPackage && (
              <section className="brand-card mt-8 p-6">
                <h3 className="text-lg font-semibold text-navy">{t("creative.copyDownload.taskTitle")}</h3>
                <p className="mt-1 text-sm text-ink-secondary">{t("creative.copyDownload.taskHint")}</p>
                <div className="mt-4">
                  <CopyDownloadButtons taskId={activeTaskId} />
                </div>
              </section>
            )}

            {!isAutoClip && primaryCreative && (
              <SingleCreativePreview slug={slug} creative={primaryCreative} />
            )}

            {marketingScore && <MarketingScorePanel score={marketingScore} />}

            {taskStatus !== "completed" && (
              <div className="mt-10">
                <PipelinePhases phases={phases} progress={progress} />
              </div>
            )}
          </>
        )}

        {isAutoClip && readyClipCount > 0 && (
          <section className="brand-card mt-8 p-6">
            <h3 className="text-lg font-semibold text-navy">
              {readyClipCount >= 3 ? t("pipeline.exportAllTitle") : t("pipeline.exportReadyTitle")}
            </h3>
            <p className="mt-1 text-sm text-ink-secondary">
              {readyClipCount < 3
                ? t("pipeline.exportPartialHint", { ready: String(readyClipCount), total: "3" })
                : exportPaywallEnabled
                  ? `${t("pipeline.exportResolutionHint")} ${t("pipeline.exportResolutionHintPaid")}`
                  : t("pipeline.exportResolutionHint")}
            </p>

            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-6">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="export-resolution"
                  checked={exportResolution === "720p"}
                  onChange={() => setExportResolution("720p")}
                />
                <span>
                  <span className="font-medium">{t("pipeline.export720p")}</span>
                  {exportPaywallEnabled && (
                    <span className="ml-1 text-stone-500">({t("pipeline.exportFree")})</span>
                  )}
                </span>
              </label>
              <label
                className={`flex items-center gap-2 text-sm ${canExport1080p ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}
              >
                <input
                  type="radio"
                  name="export-resolution"
                  checked={exportResolution === "1080p"}
                  onChange={() => canExport1080p && setExportResolution("1080p")}
                  disabled={!canExport1080p}
                />
                <span>
                  <span className="font-medium">{t("pipeline.export1080p")}</span>
                  {exportPaywallEnabled && (
                    <span className="ml-1 text-stone-500">
                      {canExport1080p
                        ? `(${t("pipeline.exportPro")})`
                        : `(${t("pipeline.exportUpgradeRequired")})`}
                    </span>
                  )}
                </span>
              </label>
              <label
                className={`flex items-center gap-2 text-sm ${canExport2k ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}
              >
                <input
                  type="radio"
                  name="export-resolution"
                  checked={exportResolution === "2k"}
                  onChange={() => canExport2k && setExportResolution("2k")}
                  disabled={!canExport2k}
                />
                <span>
                  <span className="font-medium">{t("pipeline.export2k")}</span>
                  {exportPaywallEnabled && (
                    <span className="ml-1 text-stone-500">
                      {canExport2k
                        ? `(${t("pipeline.exportPro")})`
                        : `(${t("pipeline.exportUpgradeRequired")})`}
                    </span>
                  )}
                </span>
              </label>
            </div>

            {exportStatus === "final_rendering" && exportResolution === "2k" && (
              <p className="mt-3 text-sm text-brand-blue">
                {t("export.rendition2kRendering")}{" "}
                {rendition2kProgress?.ready ?? 0}/{rendition2kProgress?.total ?? 3}
              </p>
            )}

            {exportStatus === "final_rendering" && exportResolution !== "2k" && (
              <p className="mt-3 text-sm text-brand-blue">
                {t("export.finalRendering")}{" "}
                {finalRenderProgress?.finalReady ?? 0}/{finalRenderProgress?.total ?? 3}
              </p>
            )}

            {exportStatus === "export_pending" && (
              <p className="mt-3 text-sm text-brand-blue">{t("export.packing")}</p>
            )}

            {exportStatus === "ready" && exportPackUrl && exportedResolution !== exportResolution && (
              <p className="mt-3 text-sm text-ink-secondary">
                {exportedResolution} ZIP {t("export.ready")} — switch to {exportedResolution} to download, or export {exportResolution} again.
              </p>
            )}

            {exportError && (
              <p className="mt-3 text-sm text-red-600">{exportError}</p>
            )}

            <div className="mt-4 flex flex-wrap gap-3">
              {exportPackUrl && exportStatus === "ready" && (
                <a
                  href={exportPackUrl}
                  download
                  className="brand-btn-primary"
                >
                  {t("export.download")} ({exportedResolution ?? exportResolution})
                </a>
              )}
              {!exportZipReady && (
                <button
                  type="button"
                  disabled={
                    exporting ||
                    !canExport ||
                    !allClipsPreviewReady ||
                    exportStatus === "export_pending" ||
                    exportStatus === "final_rendering"
                  }
                  onClick={exportAllClips}
                  className="brand-btn-secondary disabled:opacity-60"
                >
                  {exporting || exportStatus === "export_pending"
                    ? t("export.working")
                    : readyClipCount >= 3
                      ? t("pipeline.exportAllCta", { n: "3" })
                      : t("pipeline.exportReadyCta")}
                </button>
              )}
            </div>

            {!allClipsPreviewReady && readyClipCount > 0 && (
              <p className="mt-2 text-xs text-ink-secondary">{t("export.waitPreview")}</p>
            )}
          </section>
        )}

        {task && (
          <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-border pt-6">
            {creativeId && !isAutoClip && (videoReady || taskStatus === "completed") && (
              <Link href={`/w/${slug}/creatives/${creativeId}`} className="brand-btn-primary">
                {t("pipeline.viewCreative")}
              </Link>
            )}
            <RunCeoButton campaignId={campaignId} slug={slug} taskStatus={taskStatus} />
            {creativeId &&
              !isAutoClip &&
              (taskStatus === "completed" || progress.compliance_check?.status === "completed") && (
                <Link href={`/w/${slug}/reviews`} className="brand-btn-secondary">
                  {t("pipeline.reviewQueue")}
                </Link>
              )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
