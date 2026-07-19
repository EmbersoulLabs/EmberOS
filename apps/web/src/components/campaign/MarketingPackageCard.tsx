"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/provider";
import type { TranslationKey } from "@ceo-agent/shared/i18n";
import type { MarketingPackageCardId, ResolvedMarketingPackageCard } from "@ceo-agent/shared";
import {
  copyTextToClipboard,
  exportTextFile,
  marketingPackageExportFilename,
} from "@/lib/marketing-package-ui";

interface Props {
  campaignId: string;
  campaignName: string;
  card: ResolvedMarketingPackageCard;
  onSaved: () => Promise<void>;
}

export function MarketingPackageCard({ campaignId, campaignName, card, onSaved }: Props) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(card.text);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  const hasText = Boolean(card.text.trim());
  const sourceLabel =
    card.source === "user"
      ? t("campaign.workspace.package.sourceUser")
      : card.source === "pipeline"
        ? t("campaign.workspace.package.sourcePipeline")
        : null;

  async function handleCopy() {
    setNotice("");
    if (!hasText) {
      setNotice(t("campaign.workspace.package.copyEmpty"));
      return;
    }
    const ok = await copyTextToClipboard(card.text);
    setNotice(ok ? t("campaign.workspace.package.copySuccess") : t("campaign.workspace.package.copyFailed"));
  }

  function handleExport() {
    setNotice("");
    if (!hasText) {
      setNotice(t("campaign.workspace.package.exportEmpty"));
      return;
    }
    exportTextFile(marketingPackageExportFilename(campaignName, card.id), card.text);
    setNotice(t("campaign.workspace.package.exportSuccess"));
  }

  async function handleSaveEdit() {
    setSaving(true);
    setNotice("");
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/marketing-package`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardId: card.id, text: draft }),
      });
      const body = await res.json();
      if (!res.ok) {
        setNotice(body.error ?? t("error.generic"));
        return;
      }
      setEditing(false);
      setNotice(t("campaign.workspace.package.editSaved"));
      await onSaved();
    } finally {
      setSaving(false);
    }
  }

  function openEdit() {
    setDraft(card.text);
    setEditing(true);
    setNotice("");
  }

  return (
    <article className="rounded-xl border border-border/80 bg-surface p-4 shadow-card">
      <header className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-navy">
            {t(`campaign.workspace.package.${card.id}` as TranslationKey)}
          </h3>
          {sourceLabel && (
            <p className="mt-0.5 text-[10px] uppercase tracking-wide text-ink-secondary">
              {sourceLabel}
            </p>
          )}
        </div>
        {card.source === "user" && (
          <span className="rounded bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-800">
            {t("campaign.workspace.package.edited")}
          </span>
        )}
      </header>

      {editing ? (
        <div className="mt-3 space-y-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={6}
            className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
            placeholder={t("campaign.workspace.package.editPlaceholder")}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={handleSaveEdit}
              className="rounded-lg bg-navy px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
            >
              {saving ? t("businessProfile.saveStatus.saving") : t("campaign.workspace.package.saveEdit")}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => setEditing(false)}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-navy"
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3">
          {hasText ? (
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-sans text-sm text-ink">
              {card.text}
            </pre>
          ) : (
            <p className="text-sm text-ink-secondary">{t("campaign.workspace.package.emptyCard")}</p>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleCopy}
          className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-navy hover:border-brand-blue/30"
        >
          {t("campaign.workspace.package.copy")}
        </button>
        <button
          type="button"
          onClick={openEdit}
          className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-navy hover:border-brand-blue/30"
        >
          {t("campaign.workspace.package.edit")}
        </button>
        <button
          type="button"
          onClick={handleExport}
          className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-navy hover:border-brand-blue/30"
        >
          {t("campaign.workspace.package.export")}
        </button>
        <button
          type="button"
          disabled
          title={t("campaign.workspace.package.regeneratePlaceholder")}
          className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-ink-secondary opacity-50"
        >
          {t("campaign.workspace.regenerate.title")}
        </button>
      </div>

      {notice && <p className="mt-2 text-xs text-ink-secondary">{notice}</p>}
    </article>
  );
}
