"use client";

import { useState } from "react";
import type { MarketingContentPackage } from "@ceo-agent/shared";
import {
  MARKETING_PACK_LOCALES,
  pickCtaText,
  pickHookText,
  pickPlatformCaption,
  type MarketingPackLocale,
} from "@ceo-agent/shared";
import type { TranslationKey } from "@ceo-agent/shared/i18n";
import { useI18n } from "@/lib/i18n/provider";

const PLATFORMS = [
  { key: "tiktok", label: "TikTok" },
  { key: "instagram", label: "Instagram" },
  { key: "facebook", label: "Facebook" },
  { key: "linkedin", label: "LinkedIn" },
  { key: "xiaohongshu", label: "小红书" },
  { key: "youtubeShorts", label: "YouTube Shorts" },
  { key: "googleBusiness", label: "Google Business" },
] as const;

function LocaleTabs({
  locale,
  onChange,
}: {
  locale: MarketingPackLocale;
  onChange: (l: MarketingPackLocale) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {MARKETING_PACK_LOCALES.map((loc) => (
        <button
          key={loc}
          type="button"
          onClick={() => onChange(loc)}
          className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
            locale === loc
              ? "border-navy bg-navy text-white"
              : "border-border bg-surface text-ink-secondary hover:border-brand-blue/30"
          }`}
        >
          {t(`pipeline.marketingPackLang.${loc}` as TranslationKey)}
        </button>
      ))}
    </div>
  );
}

export function MarketingPackagePanel({ contentPackage }: { contentPackage: MarketingContentPackage }) {
  const { t } = useI18n();
  const [locale, setLocale] = useState<MarketingPackLocale>("zh");
  const hooks = contentPackage.hooks.slice(0, 5);
  const ctas = contentPackage.cta.slice(0, 5);

  return (
    <section className="brand-card mt-8 p-6">
      <h3 className="text-lg font-semibold text-navy">{t("pipeline.marketingPackTitle")}</h3>
      <p className="mt-1 text-sm text-ink-secondary">{t("pipeline.marketingPackSubtitle")}</p>

      <LocaleTabs locale={locale} onChange={setLocale} />

      {hooks.length > 0 && (
        <div className="mt-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
            {t("pipeline.marketingPackHooks")}
          </p>
          <ul className="mt-2 space-y-1.5">
            {hooks.map((h, i) => (
              <li key={i} className="text-sm text-ink">
                <span className="text-brand-blue">•</span> {pickHookText(h, locale)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {ctas.length > 0 && (
        <div className="mt-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
            {t("pipeline.marketingPackCtas")}
          </p>
          <ul className="mt-2 space-y-1.5">
            {ctas.map((c, i) => (
              <li key={i} className="text-sm text-ink">
                <span className="text-brand-teal">•</span> {pickCtaText(c, locale)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
          {t("pipeline.marketingPackPlatforms")}
        </p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {PLATFORMS.map(({ key, label }) => {
            const caption = pickPlatformCaption(contentPackage, key, locale);
            if (!caption) return null;
            return (
              <div key={key} className="rounded-lg border border-border bg-surface-muted/40 px-3 py-2">
                <p className="text-xs font-medium text-brand-blue">{label}</p>
                <p className="mt-1 whitespace-pre-line text-sm text-ink">{caption}</p>
              </div>
            );
          })}
        </div>
      </div>

      {typeof contentPackage.consistencyScore === "number" && (
        <p className="mt-4 text-sm text-ink-secondary">
          {t("pipeline.marketingPackScore")}:{" "}
          <span className="font-semibold text-navy">{contentPackage.consistencyScore}/100</span>
        </p>
      )}
    </section>
  );
}
