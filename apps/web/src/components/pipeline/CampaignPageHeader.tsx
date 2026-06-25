"use client";

import { BRAND } from "@/lib/brand";
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
    <header className="mb-8 border-b border-border pb-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-widest text-ink-secondary">
            {BRAND.product}
          </p>
          <h1 className="mt-1 truncate text-2xl font-bold tracking-tight text-navy sm:text-3xl">
            {campaignName ?? t("pipeline.title")}
          </h1>
        </div>
        {taskStatus && (
          <span
            className={`inline-flex shrink-0 items-center rounded-full px-3.5 py-1.5 text-sm font-semibold ring-1 ${statusTone}`}
          >
            {statusLabel}
          </span>
        )}
      </div>
    </header>
  );
}
