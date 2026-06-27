"use client";

import { useI18n } from "@/lib/i18n/provider";

export function CampaignPageHeader({
  campaignName,
  taskStatus,
  readyClips,
}: {
  campaignName?: string;
  taskStatus?: string;
  readyClips?: number;
}) {
  const { t } = useI18n();

  const statusLabel =
    taskStatus === "completed"
      ? t("pipeline.header.ready")
      : taskStatus === "failed"
        ? t("pipeline.header.failed")
        : readyClips !== undefined && readyClips < 3
          ? t("pipeline.header.generatingClips")
          : t("pipeline.header.generating");

  const statusTone =
    taskStatus === "completed"
      ? "bg-brand-teal/10 text-brand-teal ring-brand-teal/25"
      : taskStatus === "failed"
        ? "bg-red-50 text-red-700 ring-red-200"
        : "bg-brand-blue/10 text-brand-blue ring-brand-blue/25";

  return (
    <header>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-widest text-ink-secondary">
            {t("marketing.brand")}
          </p>
          <h1 className="mt-1 truncate text-xl font-semibold tracking-tight text-navy sm:text-2xl">
            {campaignName ?? t("pipeline.title")}
          </h1>
        </div>
        {taskStatus && (
          <span
            className={`inline-flex shrink-0 items-center rounded-full px-3 py-1 text-xs font-semibold ring-1 ${statusTone}`}
          >
            {statusLabel}
          </span>
        )}
      </div>
    </header>
  );
}
