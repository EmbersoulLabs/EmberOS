"use client";

import type { MarketingContentPackage } from "@ceo-agent/shared";
import { useI18n } from "@/lib/i18n/provider";

export function MarketingPackagePanel({ contentPackage }: { contentPackage: MarketingContentPackage }) {
  const { t } = useI18n();
  const hooks = contentPackage.hooks.slice(0, 5);
  const ctas = contentPackage.cta.slice(0, 5);
  const platforms = [
    { key: "tiktok", label: "TikTok" },
    { key: "instagram", label: "Instagram" },
    { key: "facebook", label: "Facebook" },
    { key: "linkedin", label: "LinkedIn" },
    { key: "xiaohongshu", label: "小红书" },
    { key: "youtubeShorts", label: "YouTube Shorts" },
    { key: "googleBusiness", label: "Google Business" },
  ] as const;

  return (
    <section className="brand-card mt-8 p-6">
      <h3 className="text-lg font-semibold text-navy">{t("pipeline.marketingPackTitle")}</h3>
      <p className="mt-1 text-sm text-ink-secondary">{t("pipeline.marketingPackSubtitle")}</p>

      {hooks.length > 0 && (
        <div className="mt-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
            {t("pipeline.marketingPackHooks")}
          </p>
          <ul className="mt-2 space-y-1.5">
            {hooks.map((h, i) => (
              <li key={i} className="text-sm text-ink">
                <span className="text-brand-blue">•</span> {h.text}
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
                <span className="text-brand-teal">•</span> {c.text}
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
          {platforms.map(({ key, label }) => {
            const caption = contentPackage.captions[key]?.trim();
            if (!caption) return null;
            return (
              <div key={key} className="rounded-lg border border-border bg-surface-muted/40 px-3 py-2">
                <p className="text-xs font-medium text-brand-blue">{label}</p>
                <p className="mt-1 line-clamp-3 text-sm text-ink">{caption}</p>
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
