"use client";

import { useMemo } from "react";
import { useI18n } from "@/lib/i18n/provider";
import {
  MARKETING_PACKAGE_CARD_IDS,
  resolveMarketingPackageCardContent,
  campaignHasMarketingPackageWorkspace,
  type MarketingPackageContentInput,
} from "@ceo-agent/shared";
import type { CampaignWorkspaceData } from "./CampaignWorkspaceShell";
import { MarketingPackageCard } from "./MarketingPackageCard";

interface Props {
  campaignId: string;
  data: CampaignWorkspaceData;
  onRefresh: () => Promise<void>;
}

function toContentInput(data: CampaignWorkspaceData): MarketingPackageContentInput {
  const campaign = data.campaign;
  const task = data.task;
  const creative = data.creative;
  const marketingPackage = data.marketingPackage;

  return {
    campaign: {
      name: campaign.name as string | undefined,
      campaignBrief: campaign.campaignBrief as string | undefined,
      strategyJson: campaign.strategyJson as Record<string, unknown> | undefined,
    },
    task: task
      ? {
          strategyJson: task.strategyJson as Record<string, unknown> | undefined,
          hooksJson: task.hooksJson as Record<string, unknown> | undefined,
          marketingScoreJson: task.marketingScoreJson as Record<string, unknown> | undefined,
        }
      : null,
    creative: creative
      ? {
          copyVariants: creative.copyVariants as unknown[] | undefined,
          videoUrl: creative.videoUrl as string | undefined,
          videoExportUrl: creative.videoExportUrl as string | undefined,
          editPlan: creative.editPlan as Record<string, unknown> | undefined,
        }
      : null,
    marketingPackage: marketingPackage
      ? {
          userEdited: marketingPackage.userEdited as Record<string, string> | undefined,
          strategyRef: marketingPackage.strategyRef,
          reportRef: marketingPackage.reportRef,
          hookRef: marketingPackage.hookRef as string | undefined,
          captionRef: marketingPackage.captionRef as string | undefined,
          ctaRef: marketingPackage.ctaRef as string | undefined,
          hashtagsRef: marketingPackage.hashtagsRef as string[] | undefined,
          subtitleRef: marketingPackage.subtitleRef as string | undefined,
          videoRef: marketingPackage.videoRef as string | undefined,
        }
      : null,
  };
}

export function CampaignWorkspaceMarketingPackage({ campaignId, data, onRefresh }: Props) {
  const { t } = useI18n();
  const input = useMemo(() => toContentInput(data), [data]);
  const hasPackage = campaignHasMarketingPackageWorkspace(
    { firstGeneratedAt: data.campaign.firstGeneratedAt as string | Date | null },
    data.task,
    data.marketingPackage
  );

  const cards = useMemo(
    () =>
      MARKETING_PACKAGE_CARD_IDS.map((id) => resolveMarketingPackageCardContent(id, input)),
    [input]
  );

  if (!hasPackage) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-surface-muted/30 px-6 py-16 text-center">
        <p className="text-sm text-ink-secondary">{t("campaign.workspace.empty.noPackage")}</p>
        <p className="mt-2 text-xs text-ink-secondary">{t("campaign.workspace.generate.hint")}</p>
      </div>
    );
  }

  const campaignName = (data.campaign.name as string) ?? "campaign";

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-secondary">{t("campaign.workspace.package.uiActionsNotice")}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {cards.map((card) => (
          <MarketingPackageCard
            key={card.id}
            campaignId={campaignId}
            campaignName={campaignName}
            card={card}
            onSaved={onRefresh}
          />
        ))}
      </div>
    </div>
  );
}
