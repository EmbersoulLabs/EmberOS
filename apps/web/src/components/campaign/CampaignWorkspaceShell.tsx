"use client";

import { useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { useI18n } from "@/lib/i18n/provider";
import type { TranslationKey } from "@ceo-agent/shared/i18n";
import { CAMPAIGN_OBJECTIVE_ENTRIES } from "@ceo-agent/shared";
import { CampaignWorkspaceOverview } from "./CampaignWorkspaceOverview";
import { CampaignWorkspaceMarketingPackage } from "./CampaignWorkspaceMarketingPackage";
import { CampaignWorkspaceActivity } from "./CampaignWorkspaceActivity";
import { CampaignVideoStudioShell } from "./CampaignVideoStudioShell";
import { CampaignGenerateBar } from "./CampaignGenerateBar";

export type WorkspaceTab = "overview" | "video-studio" | "marketing-package" | "activity";

export interface CampaignWorkspaceData {
  campaign: Record<string, unknown>;
  assets: Array<Record<string, unknown>>;
  task: Record<string, unknown> | null;
  creative: Record<string, unknown> | null;
  marketingPackage: Record<string, unknown> | null;
  aiGenerationState: string;
  canDelete: boolean;
}

interface Props {
  slug: string;
  campaignId: string;
  data: CampaignWorkspaceData;
  onRefresh: () => Promise<void>;
  deleting?: boolean;
  deleteError?: string;
  onDelete?: () => void;
  onDuplicate?: () => void;
  duplicating?: boolean;
}

const TABS: WorkspaceTab[] = ["overview", "video-studio", "marketing-package", "activity"];

function BusinessStatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  const key = `campaign.workspace.businessStatus.${status}` as TranslationKey;
  const label = t(key);
  const colors: Record<string, string> = {
    draft: "bg-surface-muted text-ink-secondary",
    active: "bg-emerald-50 text-emerald-800",
    completed: "bg-blue-50 text-blue-800",
    archived: "bg-amber-50 text-amber-800",
  };
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${colors[status] ?? colors.draft}`}
    >
      {label}
    </span>
  );
}

export function CampaignWorkspaceShell({
  slug,
  campaignId,
  data,
  onRefresh,
  deleting,
  deleteError,
  onDelete,
  onDuplicate,
  duplicating,
}: Props) {
  const { t } = useI18n();
  const [tab, setTab] = useState<WorkspaceTab>("overview");
  const [videoStudioOpen, setVideoStudioOpen] = useState(false);

  const campaign = data.campaign;
  const businessStatus = (campaign.businessStatus as string) ?? "draft";
  const objectiveId = campaign.campaignObjectiveId as string | undefined;
  const objectiveEntry = CAMPAIGN_OBJECTIVE_ENTRIES.find((e) => e.id === objectiveId);
  const objectiveLabel =
    objectiveId === "custom"
      ? (campaign.campaignObjectiveCustom as string)
      : objectiveEntry
        ? t(objectiveEntry.labelKey as TranslationKey)
        : (campaign.goal as string) ?? "—";

  function selectTab(next: WorkspaceTab) {
    setTab(next);
    if (next === "video-studio") {
      setVideoStudioOpen(true);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl pb-28">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-border/70 pb-5">
          <div className="min-w-0">
            <Link
              href={`/w/${slug}/campaigns`}
              className="text-xs font-medium text-ink-secondary hover:text-navy"
            >
              ← {t("campaigns.title")}
            </Link>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-navy">
                {campaign.name as string}
              </h1>
              <BusinessStatusBadge status={businessStatus} />
              {Boolean(campaign.isFavorite) && (
                <span className="text-amber-500" title={t("campaign.workspace.favorite")}>
                  ★
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-ink-secondary">{objectiveLabel}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={duplicating}
              onClick={onDuplicate}
              className="inline-flex h-9 items-center rounded-lg border border-border px-3 text-sm font-medium text-navy hover:border-brand-blue/30 disabled:opacity-60"
            >
              {duplicating ? t("campaign.workspace.duplicating") : t("campaign.workspace.duplicate")}
            </button>
            <Link
              href={`/w/${slug}/campaigns/${campaignId}/pipeline`}
              className="inline-flex h-9 items-center rounded-lg border border-border px-3 text-sm font-medium text-navy hover:border-brand-blue/30"
            >
              {t("campaign.workspace.legacyPipeline")}
            </Link>
            {data.canDelete && onDelete && (
              <button
                type="button"
                disabled={deleting}
                onClick={onDelete}
                className="inline-flex h-9 items-center rounded-lg border border-red-200 px-3 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
              >
                {deleting ? t("campaigns.deleting") : t("campaigns.delete")}
              </button>
            )}
          </div>
        </div>

        {deleteError && (
          <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {deleteError}
          </p>
        )}

        <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-border/60">
          {TABS.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => selectTab(id)}
              className={`shrink-0 border-b-2 px-4 py-2.5 text-sm font-medium transition ${
                tab === id
                  ? "border-navy text-navy"
                  : "border-transparent text-ink-secondary hover:text-navy"
              }`}
            >
              {t(`campaign.workspace.tabs.${id}` as TranslationKey)}
            </button>
          ))}
        </nav>

        {tab === "overview" && (
          <CampaignWorkspaceOverview
            slug={slug}
            campaignId={campaignId}
            data={data}
            onRefresh={onRefresh}
          />
        )}
        {tab === "video-studio" && (
          <div className="rounded-xl border border-dashed border-border bg-surface-muted/30 px-6 py-12 text-center">
            <p className="text-sm text-ink-secondary">{t("campaign.workspace.videoStudio.openHint")}</p>
            <button
              type="button"
              onClick={() => setVideoStudioOpen(true)}
              className="mt-4 inline-flex h-9 items-center rounded-lg bg-navy px-4 text-sm font-medium text-white"
            >
              {t("campaign.workspace.videoStudio.open")}
            </button>
          </div>
        )}
        {tab === "marketing-package" && (
          <CampaignWorkspaceMarketingPackage
            campaignId={campaignId}
            data={data}
            onRefresh={onRefresh}
          />
        )}
        {tab === "activity" && <CampaignWorkspaceActivity data={data} />}

        <CampaignGenerateBar
          campaignId={campaignId}
          data={data}
          onRefresh={onRefresh}
        />

        <CampaignVideoStudioShell
          open={videoStudioOpen}
          onClose={() => setVideoStudioOpen(false)}
          campaignId={campaignId}
          slug={slug}
        />
      </div>
    </AppShell>
  );
}
