"use client";

import { readCreativeAudioSettings, type EditPlan } from "@ceo-agent/shared";
import type { TranslationKey } from "@ceo-agent/shared/i18n";
import { useI18n } from "@/lib/i18n/provider";

const CATEGORY_KEYS: Record<string, TranslationKey> = {
  luxury: "creative.music.category.luxury",
  corporate: "creative.music.category.corporate",
  emotional: "creative.music.category.emotional",
  inspirational: "creative.music.category.inspirational",
  cinematic: "creative.music.category.cinematic",
  modern_tech: "creative.music.category.modern_tech",
  retail_promotion: "creative.music.category.retail_promotion",
  upbeat: "creative.music.category.upbeat",
  calm: "creative.music.category.calm",
  storytelling: "creative.music.category.storytelling",
};

export function MusicMatchPanel({
  editPlan,
  compact = false,
}: {
  editPlan: EditPlan | null | undefined;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const audio = readCreativeAudioSettings(editPlan ?? null);
  const rec = audio.bgmRecommendation;

  if (!rec || audio.bgm === "none") return null;

  const categoryKey = CATEGORY_KEYS[rec.category];
  const scoreColor =
    rec.confidenceScore >= 85
      ? "text-brand-teal"
      : rec.confidenceScore >= 70
        ? "text-brand-amber"
        : "text-ink-secondary";

  return (
    <div
      className={
        compact
          ? "space-y-2 rounded-lg border border-border/80 bg-gradient-to-br from-navy/[0.03] to-brand-blue/[0.04] p-3"
          : "brand-card space-y-4 p-5"
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-brand-blue">
            {t("creative.music.panelTitle")}
          </p>
          <p className="mt-1 text-sm font-semibold text-navy">{rec.trackName}</p>
          {categoryKey && (
            <p className="mt-0.5 text-xs text-ink-secondary">{t(categoryKey)}</p>
          )}
        </div>
        <div className="text-right">
          <p className="text-[10px] font-medium uppercase tracking-wide text-ink-secondary">
            {t("creative.music.matchScore")}
          </p>
          <p className={`text-lg font-bold tabular-nums ${scoreColor}`}>
            {rec.confidenceScore}
            <span className="text-xs font-normal text-ink-secondary">/100</span>
          </p>
        </div>
      </div>

      <p className="text-xs leading-relaxed text-ink-secondary">{rec.reason}</p>

      {rec.analysis && (
        <dl className="grid grid-cols-3 gap-2 rounded-lg bg-surface/80 p-2.5 text-[10px]">
          <div>
            <dt className="text-ink-secondary">{t("creative.music.energy")}</dt>
            <dd className="mt-0.5 font-semibold capitalize text-navy">{rec.analysis.energyLevel}</dd>
          </div>
          <div>
            <dt className="text-ink-secondary">{t("creative.music.tone")}</dt>
            <dd className="mt-0.5 font-semibold capitalize text-navy">{rec.analysis.emotionalTone}</dd>
          </div>
          <div>
            <dt className="text-ink-secondary">{t("creative.music.contentType")}</dt>
            <dd className="mt-0.5 font-semibold capitalize text-navy">
              {t(`creative.music.archetype.${rec.analysis.contentType}` as TranslationKey)}
            </dd>
          </div>
        </dl>
      )}

      {rec.license === "royalty_free" && (
        <p className="text-[10px] text-ink-secondary">{t("creative.music.royaltyFree")}</p>
      )}

      {rec.benefits.length > 0 && (
        <div>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-navy">
            {t("creative.music.whySelected")}
          </p>
          <ul className="space-y-1">
            {rec.benefits.map((benefit) => (
              <li key={benefit} className="flex items-start gap-1.5 text-xs text-ink">
                <span className="mt-0.5 text-brand-teal" aria-hidden>
                  ✓
                </span>
                <span>{benefit}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
