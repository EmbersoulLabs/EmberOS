"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  contentRevision: initialRevision = 0,
}: {
  contentPackage: MarketingContentPackage;
  taskId?: string;
  strategy?: StrategyPlan;
  contentRevision?: number;
}) {
  const { t, locale: uiLocale } = useI18n();
  const aiPref = getAiOutputLanguage();
  const packLocale = (
    aiPref === "auto" ? uiLocaleToPackLocale(uiLocale) : aiPref
  ) as MarketingPackLocale;
  const [pkg, setPkg] = useState(initialPackage);
  const [revision, setRevision] = useState(initialRevision);
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);
  const translateAttempts = useRef(new Set<string>());
  const pkgRef = useRef(pkg);
  pkgRef.current = pkg;
  const revisionRef = useRef(revision);
  revisionRef.current = revision;

  useEffect(() => {
    setPkg(initialPackage);
    setRevision(initialRevision);
  }, [initialPackage, initialRevision]);

  useEffect(() => {
    translateAttempts.current = new Set();
  }, [taskId]);

  useEffect(() => {
    if (packLocale === "zh" || !taskId) return;
    const current = pkgRef.current;
    if (isMarketingPackLocaleReady(current, packLocale)) return;
    const attemptKey = `${taskId}:${packLocale}`;
    if (translateAttempts.current.has(attemptKey)) return;
    translateAttempts.current.add(attemptKey);

    let cancelled = false;
    setTranslating(true);
    setTranslateError(null);

    (async () => {
      try {
        const res = await fetch(`/api/tasks/${taskId}/marketing-pack/translate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ locale: packLocale, contentRevision: revisionRef.current }),
        });
        const data = (await res.json()) as {
          contentPackage?: MarketingContentPackage;
          contentRevision?: number;
          translationComplete?: boolean;
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok || data.translationComplete !== true) {
          setTranslateError(data.error ?? t("error.translationFailed"));
          return;
        }
        if (data.contentPackage) setPkg(data.contentPackage);
        if (typeof data.contentRevision === "number") setRevision(data.contentRevision);
      } catch {
        if (!cancelled) setTranslateError(t("error.translationFailed"));
      } finally {
        if (!cancelled) setTranslating(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [packLocale, taskId, t]);

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
        body: JSON.stringify({
          platformId,
          asset,
          locale: packLocale,
          contentRevision: revisionRef.current,
        }),
      });
      const data = (await res.json()) as {
        contentPackage?: MarketingContentPackage;
        contentRevision?: number;
      };
      if (res.status === 409) throw new Error("conflict");
      if (!res.ok || !data.contentPackage) throw new Error("save_failed");
      setPkg(data.contentPackage);
      if (typeof data.contentRevision === "number") setRevision(data.contentRevision);
    },
    [taskId]
  );

  const onRegeneratePlatform = useCallback(
    async (platformId: MarketingPlatformId) => {
      if (!taskId) return;
      const res = await fetch(`/api/tasks/${taskId}/marketing-pack/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platformId,
          locale: packLocale,
          contentRevision: revisionRef.current,
        }),
      });
      const data = (await res.json()) as {
        contentPackage?: MarketingContentPackage;
        contentRevision?: number;
      };
      if (res.status === 409) throw new Error("conflict");
      if (!res.ok || !data.contentPackage) throw new Error("regenerate_failed");
      setPkg(data.contentPackage);
      if (typeof data.contentRevision === "number") setRevision(data.contentRevision);
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

      {taskId ? (
        <a
          href={`/api/tasks/${taskId}/marketing-pack/download`}
          className="mb-4 inline-flex h-9 items-center rounded-md border border-border px-3 text-sm font-medium text-navy"
        >
          {t("marketing.action.download")}
        </a>
      ) : null}

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
