"use client";

import { useEffect, useState } from "react";
import type { MarketingContentPackage, StrategyPlan } from "@ceo-agent/shared";
import {
  MARKETING_PACK_LOCALES,
  isMarketingPackLocaleReady,
  type MarketingPackLocale,
} from "@ceo-agent/shared";
import type { TranslationKey } from "@ceo-agent/shared/i18n";
import { useI18n } from "@/lib/i18n/provider";
import { MarketingDashboard } from "@/components/marketing-dashboard/MarketingDashboard";

function LocaleTabs({
  locale,
  onChange,
}: {
  locale: MarketingPackLocale;
  onChange: (l: MarketingPackLocale) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap gap-2">
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

export function MarketingPackagePanel({
  contentPackage: initialPackage,
  taskId,
  strategy,
}: {
  contentPackage: MarketingContentPackage;
  taskId?: string;
  strategy?: StrategyPlan;
}) {
  const { t } = useI18n();
  const [locale, setLocale] = useState<MarketingPackLocale>("zh");
  const [pkg, setPkg] = useState(initialPackage);
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);

  useEffect(() => {
    setPkg(initialPackage);
  }, [initialPackage]);

  useEffect(() => {
    if (locale === "zh" || !taskId) return;
    if (isMarketingPackLocaleReady(pkg, locale)) return;

    let cancelled = false;
    setTranslating(true);
    setTranslateError(null);

    (async () => {
      try {
        const res = await fetch(`/api/tasks/${taskId}/marketing-pack/translate`, { method: "POST" });
        const data = (await res.json()) as {
          contentPackage?: MarketingContentPackage;
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          setTranslateError(data.error ?? "Translation failed");
          return;
        }
        if (data.contentPackage) setPkg(data.contentPackage);
      } catch {
        if (!cancelled) setTranslateError("Translation failed");
      } finally {
        if (!cancelled) setTranslating(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [locale, taskId, pkg]);

  return (
    <section className="mt-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-blue">
            EmberOS Marketing OS
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-navy">
            {t("pipeline.marketingPackTitle")}
          </h2>
          <p className="mt-1 max-w-xl text-sm text-ink-secondary">
            {t("pipeline.marketingPackSubtitle")}
          </p>
        </div>
        <LocaleTabs locale={locale} onChange={setLocale} />
      </div>

      {translating && (
        <p className="mb-4 text-sm text-ink-secondary">{t("pipeline.marketingPackTranslating")}</p>
      )}
      {translateError && <p className="mb-4 text-sm text-red-600">{translateError}</p>}

      <MarketingDashboard pkg={pkg} strategy={strategy} />
    </section>
  );
}
