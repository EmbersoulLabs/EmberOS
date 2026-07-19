"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/provider";
import type { TranslationKey } from "@ceo-agent/shared/i18n";
import type { CampaignWorkspaceData } from "./CampaignWorkspaceShell";

const LOCALE_LABELS: Record<string, TranslationKey> = {
  zh: "campaign.workspace.language.zh",
  en: "campaign.workspace.language.en",
  ms: "campaign.workspace.language.ms",
};

interface Props {
  slug: string;
  campaignId: string;
  data: CampaignWorkspaceData;
  onRefresh: () => Promise<void>;
}

export function CampaignWorkspaceOverview({ slug, campaignId, data, onRefresh }: Props) {
  const { t } = useI18n();
  const campaign = data.campaign;
  const [saving, setSaving] = useState(false);
  const [brief, setBrief] = useState((campaign.campaignBrief as string) ?? "");
  const [description, setDescription] = useState((campaign.description as string) ?? "");
  const [targetAudience, setTargetAudience] = useState(
    (campaign.targetAudienceOverride as string) ?? ""
  );

  const assets = data.assets.filter((a) => {
    const meta = a.metadata as Record<string, unknown> | undefined;
    return !meta?.rejected;
  });

  async function saveField(fields: Record<string, unknown>) {
    setSaving(true);
    try {
      await fetch(`/api/campaigns/${campaignId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      await onRefresh();
    } finally {
      setSaving(false);
    }
  }

  function langLabel(key: string) {
    const locale = campaign[key] as string | undefined;
    if (!locale) return "—";
    return t(LOCALE_LABELS[locale] ?? "campaign.workspace.language.en");
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="space-y-6">
        <section className="rounded-xl border border-border/80 bg-surface p-5 shadow-card">
          <h2 className="text-sm font-semibold text-navy">{t("campaign.workspace.overview.info")}</h2>
          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-[11px] font-medium uppercase tracking-wide text-ink-secondary">
                {t("campaign.workspace.overview.created")}
              </dt>
              <dd className="mt-0.5 text-sm text-navy">
                {campaign.createdAt
                  ? new Date(campaign.createdAt as string).toLocaleString()
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] font-medium uppercase tracking-wide text-ink-secondary">
                {t("campaign.workspace.overview.updated")}
              </dt>
              <dd className="mt-0.5 text-sm text-navy">
                {campaign.updatedAt
                  ? new Date(campaign.updatedAt as string).toLocaleString()
                  : "—"}
              </dd>
            </div>
            {campaign.firstGeneratedAt ? (
              <div>
                <dt className="text-[11px] font-medium uppercase tracking-wide text-ink-secondary">
                  {t("campaign.workspace.overview.firstGenerated")}
                </dt>
                <dd className="mt-0.5 text-sm text-navy">
                  {new Date(campaign.firstGeneratedAt as string).toLocaleString()}
                </dd>
              </div>
            ) : null}
          </dl>
        </section>

        <section className="rounded-xl border border-border/80 bg-surface p-5 shadow-card">
          <h2 className="text-sm font-semibold text-navy">{t("campaign.brief.title")}</h2>
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            onBlur={() => saveField({ campaignBrief: brief })}
            rows={4}
            className="mt-3 w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
            placeholder={t("campaign.brief.placeholder")}
          />
          <label className="mt-4 block text-sm font-medium text-navy">
            {t("campaign.workspace.overview.description")}
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => saveField({ description })}
            rows={2}
            className="mt-1.5 w-full rounded-lg border border-border px-3 py-2 text-sm"
          />
          <label className="mt-4 block text-sm font-medium text-navy">
            {t("campaign.workspace.overview.targetAudience")}
          </label>
          <input
            value={targetAudience}
            onChange={(e) => setTargetAudience(e.target.value)}
            onBlur={() => saveField({ targetAudienceOverride: targetAudience })}
            className="mt-1.5 w-full rounded-lg border border-border px-3 py-2 text-sm"
          />
          {saving && (
            <p className="mt-2 text-xs text-ink-secondary">{t("businessProfile.saveStatus.saving")}</p>
          )}
        </section>

        <section className="rounded-xl border border-border/80 bg-surface p-5 shadow-card">
          <h2 className="text-sm font-semibold text-navy">{t("campaign.workspace.overview.assets")}</h2>
          {assets.length === 0 && !campaign.externalAssetUrl ? (
            <p className="mt-3 text-sm text-ink-secondary">{t("campaign.workspace.empty.noAssets")}</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {assets.map((a) => (
                <li key={a.id as string} className="text-sm text-navy">
                  {(a.type as string) ?? "file"} — {(a.storagePath as string)?.split("/").pop()}
                </li>
              ))}
              {typeof campaign.externalAssetUrl === "string" && campaign.externalAssetUrl && (
                <li className="text-sm text-navy">URL — {campaign.externalAssetUrl}</li>
              )}
            </ul>
          )}
        </section>
      </div>

      <aside className="space-y-4">
        <section className="rounded-xl border border-border/80 bg-surface p-4 shadow-card">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
            {t("campaign.workspace.overview.languages")}
          </h3>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-2">
              <dt className="text-ink-secondary">{t("campaign.workspace.language.output")}</dt>
              <dd className="font-medium text-navy">{langLabel("outputLanguage")}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-ink-secondary">{t("campaign.workspace.language.subtitle")}</dt>
              <dd className="font-medium text-navy">{langLabel("subtitleLanguage")}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-ink-secondary">{t("campaign.workspace.language.cta")}</dt>
              <dd className="font-medium text-navy">{langLabel("ctaLanguage")}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-ink-secondary">{t("campaign.workspace.language.hashtag")}</dt>
              <dd className="font-medium text-navy">{langLabel("hashtagLanguage")}</dd>
            </div>
          </dl>
        </section>

        <section className="rounded-xl border border-border/80 bg-surface p-4 shadow-card">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
            {t("campaign.workspace.progress.title")}
          </h3>
          <p className="mt-2 text-sm text-navy">
            {t(`campaign.workspace.aiState.${data.aiGenerationState}` as TranslationKey)}
          </p>
          {data.aiGenerationState === "running" && (
            <div className="mt-3">
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-muted">
                <div className="h-full w-2/3 animate-pulse rounded-full bg-brand-blue" />
              </div>
              <p className="mt-2 text-xs text-ink-secondary">
                {t("campaign.workspace.progress.estimated")}
              </p>
            </div>
          )}
        </section>
      </aside>
    </div>
  );
}
