"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/provider";
import type { TranslationKey } from "@ceo-agent/shared/i18n";
import { REGENERATE_ACTIONS } from "@ceo-agent/shared";
import type { CampaignWorkspaceData } from "./CampaignWorkspaceShell";

interface Props {
  campaignId: string;
  data: CampaignWorkspaceData;
  onRefresh: () => Promise<void>;
}

export function CampaignGenerateBar({ campaignId, data, onRefresh }: Props) {
  const { t } = useI18n();
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [regenerateOpen, setRegenerateOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");

  const campaign = data.campaign;
  const assets = data.assets.filter((a) => {
    const meta = a.metadata as Record<string, unknown> | undefined;
    return !meta?.rejected;
  });
  const canGenerate =
    assets.length > 0 || Boolean((campaign.externalAssetUrl as string)?.trim());
  const hasGenerated = Boolean(campaign.firstGeneratedAt);

  async function handleGenerate() {
    setLoading(true);
    setNotice("");
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/generate`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        setNotice(body.error ?? t("error.generic"));
        return;
      }
      if (body.placeholder) {
        setNotice(t("campaign.workspace.generate.placeholderNotice"));
      }
      setSummaryOpen(false);
      await onRefresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-ink-secondary hidden sm:block">
            {data.aiGenerationState === "running"
              ? t("campaign.workspace.progress.backgroundHint")
              : t("campaign.workspace.generate.barHint")}
          </p>
          <div className="flex w-full flex-wrap justify-end gap-2 sm:w-auto">
            {hasGenerated && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setRegenerateOpen((v) => !v)}
                  className="inline-flex h-10 items-center rounded-lg border border-border px-4 text-sm font-medium text-navy"
                >
                  {t("campaign.workspace.regenerate.title")} ▾
                </button>
                {regenerateOpen && (
                  <div className="absolute bottom-full right-0 mb-2 min-w-[200px] rounded-xl border border-border bg-surface py-1 shadow-lg">
                    {REGENERATE_ACTIONS.map((action) => (
                      <button
                        key={action}
                        type="button"
                        disabled
                        onClick={() => setRegenerateOpen(false)}
                        className="block w-full px-4 py-2 text-left text-sm text-navy hover:bg-surface-muted disabled:opacity-50"
                      >
                        {t(`campaign.workspace.regenerate.${action}` as TranslationKey)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <button
              type="button"
              disabled={!canGenerate || loading}
              onClick={() => setSummaryOpen(true)}
              className="inline-flex h-10 flex-1 items-center justify-center rounded-lg bg-navy px-6 text-sm font-medium text-white shadow-sm hover:bg-navy/90 disabled:opacity-50 sm:flex-none"
            >
              {loading ? t("campaign.workspace.generate.running") : t("campaign.workspace.generate.title")}
            </button>
          </div>
        </div>
        {notice && (
          <p className="mx-auto mt-2 max-w-6xl text-xs text-amber-800">{notice}</p>
        )}
      </div>

      {summaryOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-navy/40 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-navy">{t("campaign.workspace.generate.summaryTitle")}</h3>
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-ink-secondary">{t("campaign.name")}</dt>
                <dd className="font-medium text-navy">{campaign.name as string}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink-secondary">{t("campaign.workspace.overview.assets")}</dt>
                <dd className="font-medium text-navy">{assets.length}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink-secondary">{t("campaign.workspace.language.output")}</dt>
                <dd className="font-medium text-navy">{campaign.outputLanguage as string}</dd>
              </div>
            </dl>
            <p className="mt-4 text-xs text-ink-secondary">{t("campaign.workspace.generate.summaryBody")}</p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSummaryOpen(false)}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-navy"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={handleGenerate}
                className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {t("campaign.workspace.generate.confirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
