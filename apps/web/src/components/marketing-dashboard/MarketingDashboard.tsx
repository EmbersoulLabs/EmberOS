"use client";

import { useEffect, useMemo, useState } from "react";
import type { MarketingContentPackage, StrategyPlan } from "@ceo-agent/shared";
import {
  MARKETING_PLATFORM_IDS,
  MARKETING_PLATFORMS,
  deriveAnalysisFromPackage,
  deriveStrategyBrief,
  resolveHashtagPack,
  resolvePlatformAssets,
  resolveSeoPack,
  localizedPlatformDisplayText,
  type MarketingPlatformId,
  type PlatformMarketingAsset,
} from "@ceo-agent/shared";
import { useI18n } from "@/lib/i18n/provider";
import {
  Badge,
  CollapsibleSection,
  CopyActionBar,
  DashboardSection,
  ExpandableScoreRow,
  MetricChip,
  ScoreBar,
  StrategyField,
  TagList,
  platformAccentClass,
} from "./primitives";
import { platformEmphasisKeys, platformLabelKey } from "./platform-ui";
import { defaultSuggestions, deriveScoreInsights, scoreQualityKey } from "./score-insights";

function PlatformPanel({
  platformId,
  asset,
}: {
  platformId: MarketingPlatformId;
  asset: PlatformMarketingAsset;
}) {
  const { t } = useI18n();
  const def = MARKETING_PLATFORMS[platformId];
  const emphasis = platformEmphasisKeys(platformId);
  const fullText = localizedPlatformDisplayText(asset);

  return (
    <article className={`rounded-lg border p-4 ${platformAccentClass(def.accent)}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/60 bg-white/90 text-xs font-bold text-navy shadow-sm">
            {def.icon}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-navy">{t(platformLabelKey(platformId))}</p>
            <p className="text-xs text-ink-secondary">{t(emphasis.tagline)}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          {emphasis.chips.map((chipKey) => (
            <Badge key={chipKey} variant="muted">
              {t(chipKey)}
            </Badge>
          ))}
        </div>
      </div>

      <div className="mt-4 space-y-3 text-sm text-ink">
        {asset.hook && <FieldBlock label={t("marketing.field.hook")} value={asset.hook} highlight />}
        {asset.caption && (
          <FieldBlock label={t("marketing.field.caption")} value={asset.caption} multiline />
        )}
        {asset.title && <FieldBlock label={t("marketing.field.title")} value={asset.title} />}
        {asset.description && (
          <FieldBlock label={t("marketing.field.description")} value={asset.description} multiline />
        )}
        {asset.hashtags.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-secondary">
              {t("marketing.field.hashtags")}
            </p>
            <TagList tags={asset.hashtags} />
          </div>
        )}
        {asset.cta && (
          <div className="rounded-md border border-white/50 bg-white/70 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-secondary">
              {t("marketing.field.cta")}
            </p>
            <p className="mt-1 text-sm font-medium text-navy">{asset.cta}</p>
          </div>
        )}
      </div>

      {fullText && <CopyActionBar text={fullText} />}
    </article>
  );
}

function FieldBlock({
  label,
  value,
  multiline,
  highlight,
}: {
  label: string;
  value: string;
  multiline?: boolean;
  highlight?: boolean;
}) {
  return (
    <div
      className={
        highlight
          ? "rounded-md border border-white/50 bg-white/60 px-3 py-2"
          : "rounded-md border border-border/40 bg-white/40 px-3 py-2"
      }
    >
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-secondary">{label}</p>
      <p className={`mt-1 ${multiline ? "whitespace-pre-line leading-relaxed" : "font-medium"}`}>
        {value}
      </p>
    </div>
  );
}

function OverviewSection({
  analysis,
  insightsCtx,
}: {
  analysis: ReturnType<typeof deriveAnalysisFromPackage>;
  insightsCtx: Parameters<typeof deriveScoreInsights>[2];
}) {
  const { t } = useI18n();
  const [analysisOpen, setAnalysisOpen] = useState(false);

  return (
    <DashboardSection title={t("marketing.overview.title")} subtitle={t("marketing.overview.subtitle")}>
      <div className="flex flex-wrap items-end gap-4 sm:gap-6">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-secondary">
            {t("marketing.score.label")}
          </p>
          <div className="mt-1 flex flex-wrap items-baseline gap-2">
            <span className="text-4xl font-semibold tabular-nums tracking-tight text-navy">
              {analysis.marketingScore}
            </span>
            <span className="text-lg text-ink-secondary">{t("marketing.score.outOf")}</span>
            <Badge>{t(scoreQualityKey(analysis.marketingScore))}</Badge>
          </div>
        </div>
        <div className="grid min-w-[200px] flex-1 grid-cols-3 gap-2 sm:max-w-lg">
          <MetricChip label={t("marketing.metric.ctr")} value={analysis.estimatedCtr} accent="blue" />
          <MetricChip
            label={t("marketing.metric.engagement")}
            value={analysis.estimatedEngagement}
            accent="teal"
          />
          <MetricChip
            label={t("marketing.metric.conversion")}
            value={analysis.estimatedConversion}
            accent="navy"
          />
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ScoreBar label={t("marketing.score.hook")} value={analysis.hookScore} accent="teal" compact />
        <ScoreBar label={t("marketing.score.seo")} value={analysis.seoScore} accent="blue" compact />
        <ScoreBar
          label={t("marketing.score.emotional")}
          value={analysis.emotionalScore}
          accent="amber"
          compact
        />
        <ScoreBar
          label={t("marketing.score.conversionShort")}
          value={analysis.conversionScore}
          accent="navy"
          compact
        />
      </div>

      <button
        type="button"
        onClick={() => setAnalysisOpen((v) => !v)}
        className="mt-4 inline-flex h-8 items-center rounded-md border border-border bg-surface px-3 text-xs font-medium text-navy transition hover:bg-surface-muted"
      >
        {analysisOpen ? t("marketing.score.hideAnalysis") : t("marketing.score.viewAnalysis")}
      </button>

      {analysisOpen && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <ExpandableScoreRow
            label={t("marketing.score.hookScore")}
            value={analysis.hookScore}
            accent="teal"
            insights={deriveScoreInsights("hook", analysis.hookScore, insightsCtx, t)}
          />
          <ExpandableScoreRow
            label={t("marketing.score.seoScore")}
            value={analysis.seoScore}
            accent="blue"
            insights={deriveScoreInsights("seo", analysis.seoScore, insightsCtx, t)}
          />
          <ExpandableScoreRow
            label={t("marketing.score.emotionalScore")}
            value={analysis.emotionalScore}
            accent="amber"
            insights={deriveScoreInsights("emotional", analysis.emotionalScore, insightsCtx, t)}
          />
          <ExpandableScoreRow
            label={t("marketing.score.conversionScore")}
            value={analysis.conversionScore}
            accent="navy"
            insights={deriveScoreInsights("conversion", analysis.conversionScore, insightsCtx, t)}
          />
        </div>
      )}
    </DashboardSection>
  );
}

function PlatformTabs({
  platforms,
  active,
  onChange,
}: {
  platforms: MarketingPlatformId[];
  active: MarketingPlatformId;
  onChange: (id: MarketingPlatformId) => void;
}) {
  const { t } = useI18n();
  return (
    <div
      className="flex gap-1 overflow-x-auto rounded-lg border border-border/80 bg-surface-muted/40 p-1"
      role="tablist"
      aria-label={t("marketing.platforms.tablist")}
    >
      {platforms.map((id) => {
        const selected = id === active;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(id)}
            className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition ${
              selected
                ? "bg-surface text-navy shadow-sm ring-1 ring-border/80"
                : "text-ink-secondary hover:text-navy"
            }`}
          >
            {t(platformLabelKey(id))}
          </button>
        );
      })}
    </div>
  );
}

export function MarketingDashboard({
  pkg,
  strategy,
}: {
  pkg: MarketingContentPackage;
  strategy?: StrategyPlan;
}) {
  const { t } = useI18n();
  const analysis = pkg.analysis ?? deriveAnalysisFromPackage(pkg, strategy);
  const brief = deriveStrategyBrief(pkg, strategy);
  const platformAssets = resolvePlatformAssets(pkg);
  const seo = resolveSeoPack(pkg, strategy);
  const hashtags = resolveHashtagPack(pkg, strategy);
  const ctas = pkg.cta.slice(0, 5);
  const suggestions = pkg.aiSuggestions?.length ? pkg.aiSuggestions : defaultSuggestions(t);

  const insightsCtx = useMemo(
    () => ({ analysis, seo, brief, pkg }),
    [analysis, seo, brief, pkg]
  );

  const availablePlatforms = useMemo(
    () =>
      MARKETING_PLATFORM_IDS.filter((id) => {
        const asset = platformAssets[id];
        return asset && localizedPlatformDisplayText(asset).trim();
      }),
    [platformAssets]
  );

  const defaultPlatform = useMemo(
    () => availablePlatforms.find((id) => id === "tiktok") ?? availablePlatforms[0] ?? "tiktok",
    [availablePlatforms]
  );

  const [activePlatform, setActivePlatform] = useState<MarketingPlatformId>(defaultPlatform);

  useEffect(() => {
    if (!availablePlatforms.includes(activePlatform)) {
      setActivePlatform(defaultPlatform);
    }
  }, [availablePlatforms, activePlatform, defaultPlatform]);

  const resolvedActive = availablePlatforms.includes(activePlatform)
    ? activePlatform
    : defaultPlatform;

  const activeAsset = platformAssets[resolvedActive];

  return (
    <div className="space-y-5">
      <OverviewSection analysis={analysis} insightsCtx={insightsCtx} />

      <DashboardSection
        title={t("marketing.strategy.title")}
        subtitle={t("marketing.strategy.subtitle")}
      >
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <StrategyField label={t("marketing.strategy.primaryGoal")} value={brief.primaryGoal} />
          <StrategyField label={t("marketing.strategy.targetAudience")} value={brief.targetAudience} />
          <StrategyField label={t("marketing.strategy.contentAngle")} value={brief.contentAngle} />
          <StrategyField label={t("marketing.strategy.painPoint")} value={brief.painPoint} />
          <StrategyField label={t("marketing.strategy.desiredEmotion")} value={brief.desiredEmotion} />
          <StrategyField label={t("marketing.strategy.ctaStrategy")} value={brief.ctaStrategy} />
        </div>
      </DashboardSection>

      <DashboardSection
        title={t("marketing.platforms.title")}
        subtitle={t("marketing.platforms.subtitle", { count: availablePlatforms.length })}
        action={
          availablePlatforms.length > 0 ? (
            <Badge variant="outline">
              {t("marketing.platforms.ready", { count: availablePlatforms.length })}
            </Badge>
          ) : null
        }
      >
        {availablePlatforms.length === 0 ? (
          <p className="text-sm text-ink-secondary">{t("marketing.platforms.empty")}</p>
        ) : (
          <>
            <PlatformTabs
              platforms={availablePlatforms}
              active={resolvedActive}
              onChange={setActivePlatform}
            />
            <div className="mt-4" role="tabpanel">
              {activeAsset && localizedPlatformDisplayText(activeAsset).trim() && (
                <PlatformPanel platformId={resolvedActive} asset={activeAsset} />
              )}
            </div>
          </>
        )}
      </DashboardSection>

      <CollapsibleSection title={t("marketing.seo.title")} subtitle={t("marketing.seo.subtitle")}>
        <SeoBlock seo={seo} />
      </CollapsibleSection>

      <CollapsibleSection
        title={t("marketing.hashtags.title")}
        subtitle={t("marketing.hashtags.subtitle")}
      >
        <HashtagBlock hashtags={hashtags} />
      </CollapsibleSection>

      <CollapsibleSection title={t("marketing.cta.title")} subtitle={t("marketing.cta.subtitle")}>
        <CtaBlock ctas={ctas} />
      </CollapsibleSection>

      <CollapsibleSection
        title={t("marketing.suggestions.title")}
        subtitle={t("marketing.suggestions.subtitle")}
      >
        <SuggestionsBlock suggestions={suggestions} />
      </CollapsibleSection>

      {pkg.hooks.length > 0 && (
        <CollapsibleSection title={t("marketing.hooks.title")} subtitle={t("marketing.hooks.subtitle")}>
          <HooksBlock hooks={pkg.hooks.slice(0, 5)} />
        </CollapsibleSection>
      )}
    </div>
  );
}

function SeoBlock({ seo }: { seo: ReturnType<typeof resolveSeoPack> }) {
  const { t } = useI18n();
  return (
    <div className="space-y-3">
      {(
        [
          ["marketing.seo.primary", seo.primaryKeywords],
          ["marketing.seo.secondary", seo.secondaryKeywords],
          ["marketing.seo.longTail", seo.longTailKeywords],
          ["marketing.seo.local", seo.localKeywords],
        ] as const
      ).map(([labelKey, kws]) =>
        kws.length ? (
          <div key={labelKey}>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-secondary">
              {t(labelKey)}
            </p>
            <TagList tags={kws} />
          </div>
        ) : null
      )}
      {seo.searchIntent && (
        <p className="rounded-md border border-border/60 px-3 py-2 text-sm text-ink">
          <span className="font-medium text-brand-blue">{t("marketing.seo.searchIntent")} · </span>
          {seo.searchIntent}
        </p>
      )}
    </div>
  );
}

function HashtagBlock({ hashtags }: { hashtags: ReturnType<typeof resolveHashtagPack> }) {
  const { t } = useI18n();
  return (
    <div className="space-y-3">
      {(
        [
          ["marketing.hashtags.highVolume", hashtags.highVolume],
          ["marketing.hashtags.mediumVolume", hashtags.mediumVolume],
          ["marketing.hashtags.local", hashtags.local],
          ["marketing.hashtags.brand", hashtags.brand],
          ["marketing.hashtags.industry", hashtags.industry],
        ] as const
      ).map(([labelKey, tags]) =>
        tags.length ? (
          <div key={labelKey}>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-secondary">
              {t(labelKey)}
            </p>
            <TagList tags={tags} />
          </div>
        ) : null
      )}
    </div>
  );
}

function CtaBlock({ ctas }: { ctas: MarketingContentPackage["cta"] }) {
  const { t } = useI18n();
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {ctas.map((c, i) => (
        <div
          key={i}
          className="rounded-lg border border-brand-teal/20 bg-brand-teal/[0.04] px-3 py-2.5"
        >
          <Badge variant="outline">
            {c.style ?? t("marketing.cta.option", { n: i + 1 })}
          </Badge>
          <p className="mt-1.5 text-sm font-medium text-navy">{c.text}</p>
          <CopyActionBar text={c.text} />
        </div>
      ))}
    </div>
  );
}

function SuggestionsBlock({ suggestions }: { suggestions: string[] }) {
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {suggestions.map((s) => (
        <li
          key={s}
          className="flex gap-2 rounded-lg border border-border/60 bg-surface-muted/30 px-3 py-2 text-sm text-ink"
        >
          <span className="text-brand-teal">→</span>
          {s}
        </li>
      ))}
    </ul>
  );
}

function HooksBlock({ hooks }: { hooks: MarketingContentPackage["hooks"] }) {
  return (
    <ul className="space-y-2">
      {hooks.map((h, i) => (
        <li key={i} className="rounded-lg border border-border/50 px-3 py-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{h.type}</Badge>
            <span className="flex-1 text-ink">{h.text}</span>
          </div>
          <CopyActionBar text={h.text} />
        </li>
      ))}
    </ul>
  );
}
