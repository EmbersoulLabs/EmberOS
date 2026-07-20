"use client";

import { useState } from "react";
import type { BusinessProfileAiAnalysis } from "@ceo-agent/shared";
import { useI18n } from "@/lib/i18n/provider";
import { TagChipInput } from "./TagChipInput";

const inputClass =
  "w-full rounded-xl border border-border px-4 py-2.5 text-sm focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/20";

export type AiAnalysisDraft = BusinessProfileAiAnalysis;

export function BusinessProfileAiPanel({
  draft,
  confidence,
  sourcesUsed,
  missingSources,
  analyzing,
  error,
  onChange,
  onReanalyze,
  onAcceptSave,
  onDismiss,
}: {
  draft: AiAnalysisDraft;
  confidence: number | null;
  sourcesUsed: string[];
  missingSources: string[];
  analyzing: boolean;
  error: string | null;
  onChange: (next: AiAnalysisDraft) => void;
  onReanalyze: () => void;
  onAcceptSave: () => void;
  onDismiss: () => void;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(true);

  return (
    <section
      className="mt-4 rounded-xl border border-brand-blue/30 bg-brand-blue/5 p-4"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-navy">{t("businessProfile.ai.resultTitle")}</h2>
          <p className="mt-1 text-xs text-ink-secondary">{t("businessProfile.ai.resultHint")}</p>
        </div>
        {confidence !== null && (
          <span className="rounded-full bg-white/80 px-3 py-1 text-xs font-medium text-navy">
            {t("businessProfile.ai.confidence", { percent: String(confidence) })}
          </span>
        )}
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}

      {analyzing ? (
        <p className="mt-4 text-sm text-ink-secondary">{t("businessProfile.ai.loading")}</p>
      ) : (
        <div className={`mt-4 space-y-4 ${editing ? "" : "pointer-events-none opacity-90"}`}>
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-navy">
              {t("businessProfile.ai.brandSummary")}
            </label>
            <textarea
              className={`${inputClass} min-h-[80px]`}
              value={draft.brandSummary}
              disabled={!editing || analyzing}
              onChange={(e) => onChange({ ...draft, brandSummary: e.target.value })}
            />
          </div>

          <TagChipInput
            label={t("businessProfile.ai.brandPersonality")}
            values={draft.brandPersonality}
            onChange={(brandPersonality) => onChange({ ...draft, brandPersonality })}
            placeholder={t("businessProfile.tagPlaceholder")}
          />

          <TagChipInput
            label={t("businessProfile.ai.brandTone")}
            values={draft.brandTone}
            onChange={(brandTone) => onChange({ ...draft, brandTone })}
            placeholder={t("businessProfile.tagPlaceholder")}
          />

          <TagChipInput
            label={t("businessProfile.ai.brandKeywords")}
            values={draft.brandKeywords}
            onChange={(brandKeywords) => onChange({ ...draft, brandKeywords })}
            placeholder={t("businessProfile.tagPlaceholder")}
          />

          <TagChipInput
            label={t("businessProfile.ai.targetAudience")}
            values={draft.targetAudience}
            onChange={(targetAudience) => onChange({ ...draft, targetAudience })}
            placeholder={t("businessProfile.tagPlaceholder")}
          />

          {(sourcesUsed.length > 0 || missingSources.length > 0) && (
            <div className="rounded-lg border border-border/70 bg-white/70 px-3 py-2 text-xs text-ink-secondary">
              {sourcesUsed.length > 0 && (
                <p>
                  {t("businessProfile.ai.sourcesUsed")}: {sourcesUsed.join(", ")}
                </p>
              )}
              {missingSources.length > 0 && (
                <p className="mt-1">
                  {t("businessProfile.ai.missingSources")}: {missingSources.join(", ")}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={analyzing}
          onClick={() => setEditing(true)}
          className="rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-medium text-navy hover:border-brand-blue/40 disabled:opacity-50"
        >
          {t("businessProfile.ai.edit")}
        </button>
        <button
          type="button"
          disabled={analyzing}
          onClick={() => onReanalyze()}
          className="rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-medium text-navy hover:border-brand-blue/40 disabled:opacity-50"
        >
          {t("businessProfile.ai.reanalyze")}
        </button>
        <button
          type="button"
          disabled={analyzing || !draft.brandSummary.trim()}
          onClick={() => onAcceptSave()}
          className="rounded-lg bg-navy px-3 py-1.5 text-xs font-medium text-white hover:bg-navy/90 disabled:opacity-50"
        >
          {t("businessProfile.ai.acceptSave")}
        </button>
        <button
          type="button"
          disabled={analyzing}
          onClick={() => onDismiss()}
          className="rounded-lg border border-transparent px-3 py-1.5 text-xs font-medium text-ink-secondary hover:text-navy disabled:opacity-50"
        >
          {t("businessProfile.ai.dismiss")}
        </button>
      </div>
    </section>
  );
}
