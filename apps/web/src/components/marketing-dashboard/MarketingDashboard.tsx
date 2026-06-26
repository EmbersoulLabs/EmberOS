"use client";

import type { MarketingContentPackage, StrategyPlan } from "@ceo-agent/shared";
import {
  MARKETING_PLATFORM_IDS,
  MARKETING_PLATFORMS,
  deriveAnalysisFromPackage,
  deriveStrategyBrief,
  resolveHashtagPack,
  resolvePlatformAssets,
  resolveSeoPack,
  type MarketingPlatformId,
  type PlatformMarketingAsset,
} from "@ceo-agent/shared";
import {
  Badge,
  CopyActionBar,
  DashboardSection,
  MetricChip,
  ScoreBar,
  StrategyField,
  TagList,
  platformAccentClass,
} from "./primitives";

function platformDisplayText(asset: PlatformMarketingAsset): string {
  return [asset.title, asset.hook, asset.caption, asset.description, asset.cta]
    .filter((p) => p?.trim())
    .join("\n\n");
}

function PlatformCard({ platformId, asset }: { platformId: MarketingPlatformId; asset: PlatformMarketingAsset }) {
  const def = MARKETING_PLATFORMS[platformId];
  const fullText = platformDisplayText(asset);

  return (
    <article className={`rounded-2xl border p-4 ${platformAccentClass(def.accent)}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/80 text-xs font-bold shadow-sm">
            {def.icon}
          </span>
          <div>
            <p className="text-sm font-semibold text-navy">{def.label}</p>
            {asset.formatStyle && (
              <p className="text-[10px] text-ink-secondary">{asset.formatStyle}</p>
            )}
          </div>
        </div>
        <Badge>{def.requiredFields.length} fields</Badge>
      </div>

      <div className="mt-3 space-y-2 text-sm text-ink">
        {asset.title && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider opacity-70">Title</p>
            <p className="mt-0.5 font-medium">{asset.title}</p>
          </div>
        )}
        {asset.hook && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider opacity-70">Hook</p>
            <p className="mt-0.5">{asset.hook}</p>
          </div>
        )}
        {asset.caption && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider opacity-70">Caption</p>
            <p className="mt-0.5 whitespace-pre-line leading-relaxed">{asset.caption}</p>
          </div>
        )}
        {asset.description && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider opacity-70">Description</p>
            <p className="mt-0.5 whitespace-pre-line">{asset.description}</p>
          </div>
        )}
        <TagList tags={asset.hashtags} />
        {asset.cta && (
          <div className="rounded-lg bg-white/60 px-2.5 py-1.5 text-xs font-medium text-navy">
            CTA · {asset.cta}
          </div>
        )}
      </div>

      {fullText && <CopyActionBar text={fullText} />}
    </article>
  );
}

export function MarketingDashboard({
  pkg,
  strategy,
}: {
  pkg: MarketingContentPackage;
  strategy?: StrategyPlan;
}) {
  const analysis = pkg.analysis ?? deriveAnalysisFromPackage(pkg, strategy);
  const brief = deriveStrategyBrief(pkg, strategy);
  const platformAssets = resolvePlatformAssets(pkg);
  const seo = resolveSeoPack(pkg, strategy);
  const hashtags = resolveHashtagPack(pkg, strategy);
  const ctas = pkg.cta.slice(0, 5);
  const suggestions = pkg.aiSuggestions?.length
    ? pkg.aiSuggestions
    : [
        "Post before peak evening hours",
        "Add customer testimonial footage",
        "Use close-up product shots",
        "Test a pricing overlay",
        "Show before/after results",
      ];

  return (
    <div className="space-y-6">
      {/* 1. AI Marketing Analysis */}
      <DashboardSection title="AI Marketing Analysis" subtitle="Predicted performance & quality scores" icon="📊">
        <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
          <div className="rounded-xl border border-navy/10 bg-gradient-to-br from-navy/5 to-brand-blue/5 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-brand-blue">Marketing Score</p>
            <p className="mt-1 text-4xl font-bold tabular-nums text-navy">{analysis.marketingScore}</p>
            <p className="text-xs text-ink-secondary">/ 100 composite</p>
          </div>
          <div className="space-y-3">
            <ScoreBar label="Hook Score" value={analysis.hookScore} accent="teal" />
            <ScoreBar label="SEO Score" value={analysis.seoScore} accent="blue" />
            <ScoreBar label="Emotional Score" value={analysis.emotionalScore} accent="amber" />
            <ScoreBar label="Conversion Score" value={analysis.conversionScore} accent="navy" />
          </div>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <MetricChip label="Est. CTR" value={analysis.estimatedCtr} accent="blue" />
          <MetricChip label="Est. Engagement" value={analysis.estimatedEngagement} accent="teal" />
          <MetricChip label="Est. Conversion" value={analysis.estimatedConversion} accent="navy" />
        </div>
      </DashboardSection>

      {/* 2. Content Strategy */}
      <DashboardSection title="Content Strategy" subtitle="Why this campaign works" icon="🎯">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <StrategyField label="Primary Goal" value={brief.primaryGoal} />
          <StrategyField label="Target Audience" value={brief.targetAudience} />
          <StrategyField label="Content Angle" value={brief.contentAngle} />
          <StrategyField label="Pain Point" value={brief.painPoint} />
          <StrategyField label="Desired Emotion" value={brief.desiredEmotion} />
          <StrategyField label="CTA Strategy" value={brief.ctaStrategy} />
        </div>
      </DashboardSection>

      {/* 3. Platform-specific content */}
      <DashboardSection
        title="Platform Assets"
        subtitle="Unique copy per channel — written by platform experts"
        icon="📱"
      >
        <div className="grid gap-3 lg:grid-cols-2">
          {MARKETING_PLATFORM_IDS.map((id) => {
            const asset = platformAssets[id];
            if (!asset || !platformDisplayText(asset)) return null;
            return <PlatformCard key={id} platformId={id} asset={asset} />;
          })}
        </div>
      </DashboardSection>

      {/* 4 + 5. SEO & Hashtags */}
      <div className="grid gap-6 lg:grid-cols-2">
        <DashboardSection title="SEO Keywords" subtitle="Search intent & keyword clusters" icon="🔍">
          <div className="space-y-3">
            {(
              [
                ["Primary", seo.primaryKeywords],
                ["Secondary", seo.secondaryKeywords],
                ["Long-tail", seo.longTailKeywords],
                ["Local", seo.localKeywords],
              ] as const
            ).map(([label, kws]) =>
              kws.length ? (
                <div key={label}>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-secondary">{label}</p>
                  <TagList tags={kws} />
                </div>
              ) : null
            )}
            {seo.searchIntent && (
              <div className="mt-2 rounded-lg border border-border/60 px-3 py-2 text-sm">
                <span className="text-[10px] font-semibold uppercase text-brand-blue">Search Intent · </span>
                {seo.searchIntent}
              </div>
            )}
          </div>
        </DashboardSection>

        <DashboardSection title="Hashtag Generator" subtitle="Volume & intent buckets" icon="#">
          <div className="space-y-3">
            {(
              [
                ["High Volume", hashtags.highVolume],
                ["Medium Volume", hashtags.mediumVolume],
                ["Local", hashtags.local],
                ["Brand", hashtags.brand],
                ["Industry", hashtags.industry],
              ] as const
            ).map(([label, tags]) =>
              tags.length ? (
                <div key={label}>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-secondary">{label}</p>
                  <TagList tags={tags} />
                </div>
              ) : null
            )}
          </div>
        </DashboardSection>
      </div>

      {/* 6. CTA Generator */}
      <DashboardSection title="CTA Options" subtitle="5 distinct calls to action" icon="⚡">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {ctas.map((c, i) => (
            <div
              key={i}
              className="rounded-xl border border-brand-teal/20 bg-brand-teal/5 px-3 py-2.5"
            >
              <Badge variant="outline">{c.style ?? `CTA ${i + 1}`}</Badge>
              <p className="mt-1.5 text-sm font-medium text-navy">{c.text}</p>
              <CopyActionBar text={c.text} />
            </div>
          ))}
        </div>
      </DashboardSection>

      {/* 7. AI Suggestions */}
      <DashboardSection title="AI Suggestions" subtitle="Actionable next steps" icon="💡">
        <ul className="grid gap-2 sm:grid-cols-2">
          {suggestions.map((s, i) => (
            <li
              key={i}
              className="flex gap-2 rounded-xl border border-border/60 bg-surface-muted/30 px-3 py-2 text-sm text-ink"
            >
              <span className="text-brand-teal">→</span>
              {s}
            </li>
          ))}
        </ul>
      </DashboardSection>

      {/* Hooks (compact) */}
      {pkg.hooks.length > 0 && (
        <DashboardSection title="Hook Library" subtitle="Top scroll-stoppers" icon="🪝">
          <ul className="space-y-2">
            {pkg.hooks.slice(0, 5).map((h, i) => (
              <li key={i} className="rounded-lg border border-border/50 px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>{h.type}</Badge>
                  <span className="flex-1 text-ink">{h.text}</span>
                </div>
                <CopyActionBar text={h.text} />
              </li>
            ))}
          </ul>
        </DashboardSection>
      )}
    </div>
  );
}
