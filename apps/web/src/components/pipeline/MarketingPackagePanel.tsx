"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  MarketingContentPackage,
  MarketingPlatformId,
  PlatformMarketingAsset,
  StrategyPlan,
} from "@ceo-agent/shared";
import {
  isMarketingPackLocaleReady,
  localizeMarketingPackage,
  uiLocaleToPackLocale,
  type MarketingPackLocale,
} from "@ceo-agent/shared";
import { useI18n } from "@/lib/i18n/provider";
import { getAiOutputLanguage } from "@/lib/preferences";
import { MarketingDashboard } from "@/components/marketing-dashboard/MarketingDashboard";

export function MarketingPackagePanel({
  contentPackage: initialPackage,
  taskId,
  strategy,
}: {
  contentPackage: MarketingContentPackage;
  taskId?: string;
  strategy?: StrategyPlan;
}) {
  const { t, locale: uiLocale } = useI18n();
  const aiPref = getAiOutputLanguage();
  const packLocale = (
    aiPref === "auto" ? uiLocaleToPackLocale(uiLocale) : aiPref
  ) as MarketingPackLocale;
  const [pkg, setPkg] = useState(initialPackage);
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);

  useEffect(() => {
    setPkg(initialPackage);
  }, [initialPackage]);

  useEffect(() => {
    if (packLocale === "zh" || !taskId) return;
    if (isMarketingPackLocaleReady(pkg, packLocale)) return;

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
          setTranslateError(data.error ?? t("error.translationFailed"));
          return;
        }
        if (data.contentPackage) setPkg(data.contentPackage);
      } catch {
        if (!cancelled) setTranslateError(t("error.translationFailed"));
      } finally {
        if (!cancelled) setTranslating(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [packLocale, taskId, pkg, t]);

  const displayPackage = useMemo(
    () => localizeMarketingPackage(pkg, packLocale),
    [pkg, packLocale]
  );

  const onEditPlatform = useCallback(
    async (platformId: MarketingPlatformId, asset: PlatformMarketingAsset) => {
      if (!taskId) return;
      const res = await fetch(`/api/tasks/${taskId}/marketing-pack`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platformId, asset }),
      });
      const data = (await res.json()) as { contentPackage?: MarketingContentPackage };
      if (!res.ok || !data.contentPackage) throw new Error("save_failed");
      setPkg(data.contentPackage);
    },
    [taskId]
  );

  const onRegeneratePlatform = useCallback(
    async (platformId: MarketingPlatformId) => {
      if (!taskId) return;
      const res = await fetch(`/api/tasks/${taskId}/marketing-pack/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platformId }),
      });
      const data = (await res.json()) as { contentPackage?: MarketingContentPackage };
      if (!res.ok || !data.contentPackage) throw new Error("regenerate_failed");
      setPkg(data.contentPackage);
    },
    [taskId]
  );

  return (
    <section className="mt-8">
      <div className="mb-5 border-b border-border/70 pb-4">
        <p className="text-[11px] font-medium uppercase tracking-widest text-ink-secondary">
          {t("marketing.brand")}
        </p>
        <h2 className="mt-1 text-lg font-semibold tracking-tight text-navy">
          {t("pipeline.marketingPackTitle")}
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-ink-secondary">
          {t("pipeline.marketingPackSubtitle")}
        </p>
      </div>

      {translating && (
        <p className="mb-4 text-sm text-ink-secondary">{t("pipeline.marketingPackTranslating")}</p>
      )}
      {translateError && <p className="mb-4 text-sm text-red-600">{translateError}</p>}

      <MarketingDashboard
        pkg={displayPackage}
        strategy={strategy}
        onEditPlatform={taskId ? onEditPlatform : undefined}
        onRegeneratePlatform={taskId ? onRegeneratePlatform : undefined}
      />
    </section>
  );
}
