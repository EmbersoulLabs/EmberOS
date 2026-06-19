"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { AppShell, StatusBadge } from "@/components/AppShell";
import { RunCeoButton } from "@/components/RunCeoButton";
import { isCampaignDeletable } from "@/lib/campaigns";
import { useI18n } from "@/lib/i18n/provider";
import type { TranslationKey } from "@ceo-agent/shared/i18n";

const STEPS = [
  "parse_intent",
  "strategy_plan",
  "ceo_plan",
  "vision_analyze",
  "content_classify",
  "hook_generate",
  "copy_generate",
  "edit_director_plan",
  "ffmpeg_render",
  "compliance_check",
  "marketing_score",
  "human_review",
] as const;

function stepLabel(step: string, t: (key: TranslationKey) => string): string {
  return t(`step.${step}` as TranslationKey);
}

function MarketingScorePanel({ score }: { score: Record<string, unknown> }) {
  const overall = score.overallScore as number | undefined;
  const improvements = (score.improvements as string[] | undefined) ?? [];
  const dimensions = [
    { key: "hookScore", label: "Hook" },
    { key: "visualScore", label: "Visual" },
    { key: "copyScore", label: "Copy" },
    { key: "ctaScore", label: "CTA" },
    { key: "platformFitScore", label: "Platform" },
  ] as const;

  if (overall === undefined) return null;

  return (
    <div className="mt-3 rounded-lg bg-stone-50 px-3 py-3 text-sm">
      <div className="mb-2 flex items-center gap-2">
        <span className="font-semibold text-coal">Marketing Score</span>
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-lg font-bold text-primary">
          {overall}
        </span>
      </div>
      <div className="mb-2 flex flex-wrap gap-2">
        {dimensions.map(({ key, label }) => {
          const val = score[key] as number | undefined;
          if (val === undefined) return null;
          return (
            <span key={key} className="rounded border bg-white px-2 py-1 text-xs text-stone-600">
              {label}: {val}
            </span>
          );
        })}
      </div>
      {improvements.length > 0 && (
        <ul className="list-inside list-disc text-xs text-stone-600">
          {improvements.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function computeProgress(
  progress: Record<string, { status: string; percent?: number }>,
  taskStatus?: string
): { percent: number; currentStep: string | null; videoReady: boolean } {
  if (taskStatus === "completed") {
    return { percent: 100, currentStep: null, videoReady: true };
  }
  if (taskStatus === "failed") {
    const done = STEPS.filter((s) => progress[s]?.status === "completed").length;
    return {
      percent: Math.round((done / STEPS.length) * 100),
      currentStep: STEPS.find((s) => progress[s]?.status === "failed") ?? null,
      videoReady: progress.ffmpeg_render?.status === "completed",
    };
  }

  let score = 0;
  let currentStep: string | null = null;

  for (const step of STEPS) {
    const entry = progress[step];
    const status = entry?.status ?? "pending";
    if (status === "completed") {
      score += 1;
    } else if (status === "running") {
      if (step === "ffmpeg_render" && typeof entry?.percent === "number") {
        score += entry.percent / 100;
      } else {
        score += 0.5;
      }
      if (!currentStep) currentStep = step;
    } else if (!currentStep && status === "pending") {
      currentStep = step;
    }
  }

  if (!currentStep) {
    currentStep = STEPS.find((s) => progress[s]?.status === "running") ?? null;
  }

  const videoReady = progress.ffmpeg_render?.status === "completed";

  return {
    percent: Math.min(99, Math.round((score / STEPS.length) * 100)),
    currentStep,
    videoReady,
  };
}

function PipelineProgressBar({
  percent,
  currentStep,
  taskStatus,
}: {
  percent: number;
  currentStep: string | null;
  taskStatus?: string;
}) {
  const { t } = useI18n();
  const label =
    taskStatus === "completed"
      ? t("pipeline.complete")
      : taskStatus === "failed"
        ? t("pipeline.failed")
        : currentStep
          ? stepLabel(currentStep, t)
          : t("pipeline.starting");

  return (
    <div className="mt-6 rounded-xl border border-orange-200/60 bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="font-medium text-coal">{label}</span>
        <span className="tabular-nums text-ember">{percent}%</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-stone-200">
        <div
          className={`h-full rounded-full transition-all duration-500 ease-out ${
            taskStatus === "failed"
              ? "bg-red-500"
              : "bg-gradient-to-r from-ember via-flame to-ember-glow"
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>
      {taskStatus === "running" && (
        <p className="mt-2 text-xs text-stone-500">{t("pipeline.renderHint")}</p>
      )}
    </div>
  );
}

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
  const [creativeMeta, setCreativeMeta] = useState<Record<string, unknown> | null>(null);
  const [campaignStatus, setCampaignStatus] = useState<string | null>(null);
  const [canDelete, setCanDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [pollError, setPollError] = useState("");

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
      if (campStatus) setCampaignStatus(campStatus);
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
      if (!taskId) return;

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
      if (data.creative) setCreativeMeta(data.creative as Record<string, unknown>);

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

      if (data.task?.status === "completed" || data.task?.status === "failed") {
        if (interval) clearInterval(interval);
      }
      } catch (err) {
        setPollError(err instanceof Error ? err.message : "Failed to load progress");
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
      renderStatus?: string;
    }
  >;
  const renderStatus = creativeMeta?.renderStatus as string | undefined;
  const taskError = task?.errorMessage as string | undefined;
  const taskStatus = task?.status as string | undefined;
  const { percent, currentStep, videoReady } = computeProgress(progress, taskStatus);
  const showDelete =
    canDelete ||
    taskStatus === "failed" ||
    STEPS.some((step) => progress[step]?.status === "failed") ||
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

  return (
    <AppShell>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">{t("pipeline.title")}</h1>
          {task && <StatusBadge status={taskStatus!} />}
          {renderStatus && renderStatus !== "none" && (
            <StatusBadge status={renderStatus} />
          )}
        </div>
        {showDelete && (
          <button
            type="button"
            disabled={deleting}
            onClick={deleteCampaign}
            className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
          >
            {deleting ? t("campaigns.deleting") : t("campaigns.deleteCampaign")}
          </button>
        )}
      </div>

      {deleteError && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {deleteError}
        </p>
      )}

      {pollError && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-medium">{pollError}</p>
          <p className="mt-1 text-xs text-amber-800">
            若刚升级 EmberOS，请在 Supabase SQL Editor 运行 packages/db/sql/marketing_os.sql，然后重启 pnpm dev。
          </p>
        </div>
      )}

      {task && (
        <PipelineProgressBar
          percent={percent}
          currentStep={currentStep}
          taskStatus={taskStatus}
        />
      )}

      {taskError && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {taskError}
        </div>
      )}

      <div className="mt-6 space-y-3">
        {STEPS.map((step) => {
          const s = progress[step];
          const status = s?.status ?? "pending";
          return (
            <div
              key={step}
              className="rounded-lg border bg-white px-4 py-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm">
                  <span className="font-medium text-coal">{stepLabel(step, t)}</span>
                  <span className="ml-2 font-mono text-xs text-stone-400">{step}</span>
                </span>
                <StatusBadge status={status} />
              </div>
              {s?.error && (
                <p className="mt-2 text-xs text-red-600">{s.error}</p>
              )}
              {step === "ffmpeg_render" && typeof s?.percent === "number" && status === "running" && (
                <div className="mt-3">
                  <div className="mb-1 flex justify-between text-xs text-stone-500">
                    <span>{s.phase ?? "render"}</span>
                    <span>{s.percent}%</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-stone-200">
                    <div
                      className="h-full rounded-full bg-ember transition-all duration-300"
                      style={{ width: `${s.percent}%` }}
                    />
                  </div>
                </div>
              )}
              {step === "marketing_score" &&
              s?.output != null &&
              typeof s.output === "object" ? (
                <MarketingScorePanel score={s.output as Record<string, unknown>} />
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        {creativeId &&
          (videoReady || taskStatus === "completed" ? (
            <Link
              href={`/w/${slug}/creatives/${creativeId}`}
              className="rounded-lg bg-primary px-4 py-2 text-sm text-white hover:bg-primary-hover"
            >
              {t("pipeline.viewCreative")}
            </Link>
          ) : (
            <span
              className="cursor-not-allowed rounded-lg bg-stone-200 px-4 py-2 text-sm text-stone-500"
              title="Available after video render completes"
            >
              {t("pipeline.viewCreativeWait")}
            </span>
          ))}
        <RunCeoButton campaignId={campaignId} slug={slug} taskStatus={taskStatus} />
        {creativeId &&
          (taskStatus === "completed" ||
            progress.compliance_check?.status === "completed") && (
            <Link
              href={`/w/${slug}/reviews`}
              className="rounded-lg border px-4 py-2 text-sm hover:border-primary"
            >
              {t("pipeline.reviewQueue")}
            </Link>
          )}
      </div>
    </AppShell>
  );
}
