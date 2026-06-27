"use client";

import Link from "next/link";
import { parseCampaignCreativeBrief, isCampaignExportable, isReviewPending } from "@ceo-agent/shared";
import type { TranslationKey } from "@ceo-agent/shared/i18n";
import { CAMPAIGN_GOAL_OPTIONS } from "@ceo-agent/shared/i18n";
import { AppShell, StatusBadge } from "@/components/AppShell";
import { RunCeoButton } from "@/components/RunCeoButton";
import { ClipPreviewGrid } from "@/components/pipeline/ClipPreviewGrid";
import { PipelineHero } from "@/components/pipeline/PipelineHero";
import { PipelinePhases } from "@/components/pipeline/PipelinePhases";
import { DashboardSection, CollapsibleSection } from "@/components/marketing-dashboard/primitives";
import { formatClipDuration, formatPlatformLabel } from "@/lib/clip-utils";
import {
  AGENCY_PIPELINE_PHASES,
  AGENCY_STEPS,
  AUTO_CLIP_PIPELINE_PHASES,
  AUTO_CLIP_STEPS,
  computePipelineProgress,
  isAutoClipTask,
} from "@/lib/pipeline-config";
import { useI18n } from "@/lib/i18n/provider";

export interface CampaignDashboardData {
  campaign: Record<string, unknown>;
  assets: Array<Record<string, unknown>>;
  task: Record<string, unknown> | null;
  creative: Record<string, unknown> | null;
  creatives: Array<Record<string, unknown>>;
  hasVideoAsset: boolean;
  clipCount: number;
  canDelete: boolean;
}

function formatFileSize(bytes?: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function assetFileName(storagePath: string): string {
  return storagePath.split("/").pop() ?? storagePath;
}

function BriefField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-ink-secondary">{label}</dt>
      <dd className="mt-0.5 text-sm text-navy">{value}</dd>
    </div>
  );
}

function CampaignBriefCard({ campaign }: { campaign: Record<string, unknown> }) {
  const { t } = useI18n();
  const brief = parseCampaignCreativeBrief({
    campaignBrief: campaign.campaignBrief as string | null,
    voicePreset: campaign.voicePreset as string | null,
    contentStyle: campaign.contentStyle as string | null,
    campaignGoal: campaign.campaignGoal as string | null,
    bgmPreference: campaign.bgmPreference as string | null,
    metadata: campaign.metadata as Record<string, unknown> | null,
  });

  const legacyGoal = campaign.goal as string | undefined;
  const legacyGoalKey = CAMPAIGN_GOAL_OPTIONS.find((g) => g.value === legacyGoal)?.key;
  const platforms = (campaign.platforms as string[] | undefined) ?? [];

  const hasBrief =
    brief.campaignBrief ||
    brief.campaignGoal ||
    brief.contentStyle ||
    (brief.voicePreset && brief.voicePreset !== "auto") ||
    legacyGoal ||
    platforms.length > 0;

  return (
    <DashboardSection title={t("campaign.dashboard.briefTitle")}>
      {!hasBrief ? (
        <p className="px-4 py-4 text-sm text-ink-secondary sm:px-5">{t("campaign.dashboard.briefEmpty")}</p>
      ) : (
        <dl className="grid gap-4 px-4 py-4 sm:grid-cols-2 sm:px-5">
          {platforms.length > 0 && (
            <BriefField
              label={t("campaign.platforms")}
              value={platforms.map((p) => formatPlatformLabel(p)).join(" · ")}
            />
          )}
          {legacyGoal && (
            <BriefField
              label={t("campaign.goal")}
              value={legacyGoalKey ? t(legacyGoalKey) : legacyGoal}
            />
          )}
          {brief.campaignGoal && (
            <BriefField
              label={t("campaign.marketingGoal.title")}
              value={t(`campaign.marketingGoal.${brief.campaignGoal}` as TranslationKey)}
            />
          )}
          {brief.contentStyle && (
            <BriefField
              label={t("campaign.style.title")}
              value={t(`campaign.style.${brief.contentStyle}` as TranslationKey)}
            />
          )}
          {brief.voicePreset && brief.voicePreset !== "auto" && (
            <BriefField
              label={t("campaign.voice.title")}
              value={t(`campaign.voice.${brief.voicePreset}` as TranslationKey)}
            />
          )}
          {brief.bgmPreference && brief.bgmPreference !== "auto" && (
            <BriefField
              label={t("campaign.bgm.title")}
              value={t(`campaign.bgm.${brief.bgmPreference}` as TranslationKey)}
            />
          )}
        </dl>
      )}
      {brief.campaignBrief && (
        <div className="border-t border-border/60 px-4 py-4 sm:px-5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-ink-secondary">
            {t("campaign.brief.title")}
          </p>
          <p className="mt-2 line-clamp-6 whitespace-pre-wrap text-sm leading-relaxed text-ink">
            {brief.campaignBrief}
          </p>
        </div>
      )}
    </DashboardSection>
  );
}

function CampaignAssetsCard({ assets }: { assets: Array<Record<string, unknown>> }) {
  const { t } = useI18n();

  const visible = assets.filter((a) => {
    const meta = a.metadata as Record<string, unknown> | undefined;
    return !meta?.rejected;
  });

  const videos = visible.filter((a) => a.type === "video");
  const images = visible.filter((a) => a.type === "image");

  return (
    <DashboardSection
      title={t("campaign.dashboard.assetsTitle")}
      subtitle={
        visible.length > 0
          ? t("campaign.dashboard.assetsCount", {
              videos: String(videos.length),
              images: String(images.length),
            })
          : undefined
      }
    >
      {visible.length === 0 ? (
        <p className="px-4 py-4 text-sm text-ink-secondary sm:px-5">{t("campaign.dashboard.assetsEmpty")}</p>
      ) : (
        <ul className="divide-y divide-border/60">
          {visible.map((asset) => {
            const type = asset.type as string;
            const duration = asset.durationSec ? Number(asset.durationSec) : undefined;
            const isVideo = type === "video";

            return (
              <li key={asset.id as string} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-semibold ${
                    isVideo ? "bg-brand-blue/10 text-brand-blue" : "bg-brand-teal/10 text-brand-teal"
                  }`}
                >
                  {isVideo ? t("campaign.fileVideo") : t("campaign.fileImage")}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-navy">
                    {assetFileName(asset.storagePath as string)}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-secondary">
                    {isVideo && duration ? formatClipDuration(duration) : "—"}
                    {" · "}
                    {formatFileSize(asset.fileSizeBytes as number | undefined)}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </DashboardSection>
  );
}

export function CampaignDashboard({
  slug,
  campaignId,
  data,
  deleting,
  deleteError,
  onDelete,
}: {
  slug: string;
  campaignId: string;
  data: CampaignDashboardData;
  deleting: boolean;
  deleteError: string;
  onDelete: () => void;
}) {
  const { t } = useI18n();

  const { campaign, assets, task, creatives, hasVideoAsset, clipCount, canDelete } = data;
  const status = campaign.status as string;
  const taskStatus = task?.status as string | undefined;
  const taskId = task?.id as string | undefined;
  const stepProgress = (task?.stepProgress ?? {}) as Record<
    string,
    { status: string; error?: string; output?: unknown; percent?: number }
  >;

  const autoClip = isAutoClipTask(stepProgress, creatives.length);
  const steps = autoClip ? AUTO_CLIP_STEPS : AGENCY_STEPS;
  const phases = autoClip ? AUTO_CLIP_PIPELINE_PHASES : AGENCY_PIPELINE_PHASES;
  const pipeline = computePipelineProgress(stepProgress, taskStatus, steps);

  const readyClips = creatives.filter((c) => c.videoUrl).length;
  const taskHref = `/w/${slug}/campaigns/${campaignId}/task${taskId ? `?taskId=${taskId}` : ""}`;
  const exportHref =
    data.creative?.id ? `/w/${slug}/creatives/${data.creative.id}/export` : null;
  const canExport = isCampaignExportable(status);
  const reviewPending = isReviewPending(status);
  const reviewsHref = `/w/${slug}/reviews`;
  const rejectedCreatives = creatives.filter((c) => c.status === "compliance_failed");

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-border/70 pb-5">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-widest text-ink-secondary">
              {t("campaigns.title")}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight text-navy">
                {(campaign.name as string) ?? t("campaign.defaultName")}
              </h1>
              <StatusBadge status={status} />
              {taskStatus && <StatusBadge status={taskStatus} />}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <RunCeoButton
              campaignId={campaignId}
              slug={slug}
              taskStatus={taskStatus}
              primary
            />
            {task && (
              <Link
                href={taskHref}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-navy hover:bg-surface-muted"
              >
                {t("campaign.dashboard.viewFullProgress")}
              </Link>
            )}
            {exportHref && canExport && (
              <Link
                href={exportHref}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-navy hover:bg-surface-muted"
              >
                {t("campaign.dashboard.exportPack")}
              </Link>
            )}
            {canDelete && (
              <button
                type="button"
                disabled={deleting}
                onClick={onDelete}
                className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
              >
                {deleting ? t("campaigns.deleting") : t("campaigns.delete")}
              </button>
            )}
          </div>
        </header>

        {deleteError && (
          <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {deleteError}
          </p>
        )}

        {rejectedCreatives.length > 0 && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-900">
            <p className="font-medium">{t("campaign.review.rejectedBanner")}</p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {rejectedCreatives.map((c, i) => (
                <li key={c.id as string}>
                  <Link
                    href={`/w/${slug}/creatives/${c.id as string}`}
                    className="inline-flex h-8 items-center rounded-md border border-red-300 bg-white px-3 text-xs font-medium text-red-700 hover:bg-red-100"
                  >
                    {t("campaign.review.fixClip", { n: String(i + 1) })}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid gap-5 lg:grid-cols-2">
          <CampaignBriefCard campaign={campaign} />
          <CampaignAssetsCard assets={assets} />
        </div>

        {reviewPending && (
          <div className="mt-5">
            <DashboardSection title={t("campaign.review.title")}>
              <div className="space-y-3 px-4 py-4 sm:px-5">
                <p className="text-sm text-ink-secondary">
                  {status === "pending_internal_review"
                    ? t("campaign.review.pendingInternal")
                    : t("campaign.review.pendingClient")}
                </p>
                <Link
                  href={reviewsHref}
                  className="inline-flex h-9 items-center rounded-lg bg-navy px-4 text-sm font-medium text-white hover:bg-navy/90"
                >
                  {t("campaign.review.goToQueue")}
                </Link>
              </div>
            </DashboardSection>
          </div>
        )}

        <div className="mt-5">
          {!task ? (
            <DashboardSection title={t("campaign.dashboard.progressTitle")}>
              <p className="px-4 py-4 text-sm text-ink-secondary sm:px-5">
                {hasVideoAsset ? t("campaign.dashboard.noTask") : t("campaign.dashboard.uploadFirst")}
              </p>
            </DashboardSection>
          ) : (
            <DashboardSection
              title={t("campaign.dashboard.progressTitle")}
              action={
                <Link href={taskHref} className="text-xs font-medium text-brand-blue hover:underline">
                  {t("campaign.dashboard.viewFullProgress")}
                </Link>
              }
            >
              <div className="space-y-4 px-4 py-4 sm:px-5">
                <PipelineHero
                  percent={pipeline.percent}
                  currentStep={pipeline.currentStep}
                  currentStepIndex={pipeline.currentStepIndex}
                  totalSteps={steps.length}
                  taskStatus={taskStatus}
                />

                {hasVideoAsset && (
                  <p className="text-sm text-ink-secondary">
                    {readyClips < 3
                      ? t("pipeline.clipsGenerating", { ready: String(readyClips), total: "3" })
                      : t("campaign.detail.viewClips", { count: "3", ready: String(clipCount) })}
                  </p>
                )}

                {(taskStatus === "queued" || taskStatus === "running" || taskStatus === "failed") && (
                  <CollapsibleSection
                    title={t("pipeline.pipelineTitle")}
                    subtitle={t("pipeline.pipelineSubtitle")}
                    defaultOpen={taskStatus === "failed"}
                  >
                    <div className="px-1 pb-1">
                      <PipelinePhases phases={phases} progress={stepProgress} compact />
                    </div>
                  </CollapsibleSection>
                )}
              </div>
            </DashboardSection>
          )}
        </div>

        {creatives.length > 0 && (
          <div className="mt-8">
            <ClipPreviewGrid slug={slug} creatives={creatives} />
          </div>
        )}
      </div>
    </AppShell>
  );
}
