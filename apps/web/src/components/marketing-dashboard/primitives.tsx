"use client";

import { useCallback, useState, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n/provider";

const ACCENT: Record<string, string> = {
  blue: "border-brand-blue/25 bg-brand-blue/[0.04] text-brand-blue",
  teal: "border-brand-teal/25 bg-brand-teal/[0.04] text-brand-teal",
  navy: "border-navy/15 bg-navy/[0.04] text-navy",
  amber: "border-brand-amber/25 bg-brand-amber/[0.04] text-brand-amber",
};

const BAR_COLOR: Record<string, string> = {
  blue: "bg-brand-blue",
  teal: "bg-brand-teal",
  navy: "bg-navy",
  amber: "bg-brand-amber",
};

export function DashboardSection({
  title,
  subtitle,
  children,
  className = "",
  action,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
}) {
  return (
    <section className={`rounded-xl border border-border/80 bg-surface shadow-card ${className}`}>
      <div className="flex items-start justify-between gap-3 border-b border-border/60 px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <h3 className="text-[13px] font-semibold tracking-tight text-navy">{title}</h3>
          {subtitle && (
            <p className="mt-0.5 text-xs leading-snug text-ink-secondary">{subtitle}</p>
          )}
        </div>
        {action}
      </div>
      <div className="px-4 py-4 sm:px-5">{children}</div>
    </section>
  );
}

export function CollapsibleSection({
  title,
  subtitle,
  defaultOpen = false,
  children,
}: {
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const { t } = useI18n();
  return (
    <section className="rounded-xl border border-border/80 bg-surface shadow-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left sm:px-5"
      >
        <div>
          <p className="text-[13px] font-semibold text-navy">{title}</p>
          {subtitle && <p className="mt-0.5 text-xs text-ink-secondary">{subtitle}</p>}
        </div>
        <span className="shrink-0 text-xs font-medium text-ink-secondary">
          {open ? t("common.collapse") : t("common.expand")}
        </span>
      </button>
      {open && <div className="border-t border-border/60 px-4 py-4 sm:px-5">{children}</div>}
    </section>
  );
}

export function ScoreBar({
  label,
  value,
  accent = "blue",
  compact = false,
}: {
  label: string;
  value: number;
  accent?: keyof typeof ACCENT;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "" : "min-w-0 flex-1"}>
      <div className="mb-1 flex items-center justify-between gap-2 text-xs">
        <span className="truncate font-medium text-ink-secondary">{label}</span>
        <span className="shrink-0 tabular-nums font-semibold text-navy">{value}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-muted">
        <div
          className={`h-full rounded-full transition-all duration-500 ${BAR_COLOR[accent] ?? BAR_COLOR.blue}`}
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      </div>
    </div>
  );
}

export function ExpandableScoreRow({
  label,
  value,
  accent = "blue",
  insights,
}: {
  label: string;
  value: number;
  accent?: keyof typeof ACCENT;
  insights: string[];
}) {
  const [open, setOpen] = useState(false);
  const { t } = useI18n();
  return (
    <div className="rounded-lg border border-border/60 bg-surface-muted/20 px-3 py-2.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <ScoreBar label={label} value={value} accent={accent} />
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mt-0.5 shrink-0 rounded-md border border-border bg-surface px-2 py-1 text-[11px] font-medium text-ink-secondary transition hover:border-navy/20 hover:text-navy"
        >
          {open ? t("marketing.score.hide") : t("marketing.score.why")}
        </button>
      </div>
      {open && insights.length > 0 && (
        <ul className="mt-2.5 space-y-1 border-t border-border/50 pt-2.5 text-xs leading-relaxed text-ink-secondary">
          {insights.map((tip) => (
            <li key={tip} className="flex gap-2">
              <span className="text-brand-blue">•</span>
              <span>{tip}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function MetricChip({
  label,
  value,
  accent = "blue",
}: {
  label: string;
  value: string;
  accent?: keyof typeof ACCENT;
}) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${ACCENT[accent] ?? ACCENT.blue}`}>
      <p className="text-[10px] font-medium uppercase tracking-wide opacity-75">{label}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
}

export function Badge({
  children,
  variant = "default",
}: {
  children: ReactNode;
  variant?: "default" | "outline" | "muted";
}) {
  const base = "inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium";
  if (variant === "outline")
    return (
      <span className={`${base} border border-border text-ink-secondary`}>{children}</span>
    );
  if (variant === "muted")
    return <span className={`${base} bg-surface-muted text-ink-secondary`}>{children}</span>;
  return (
    <span className={`${base} bg-brand-blue/10 text-brand-blue`}>{children}</span>
  );
}

export function StrategyField({ label, value }: { label: string; value: string }) {
  if (!value?.trim()) return null;
  return (
    <div className="rounded-lg border border-border/60 bg-surface-muted/30 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-secondary">
        {label}
      </p>
      <p className="mt-1 text-sm leading-snug text-ink">{value}</p>
    </div>
  );
}

export function CopyActionBar({ text }: { text: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }, [text]);

  const btn =
    "inline-flex h-8 items-center rounded-md border border-border bg-surface px-2.5 text-xs font-medium text-ink-secondary transition hover:border-navy/25 hover:bg-surface-muted hover:text-navy";

  return (
    <div className="flex flex-wrap gap-1.5 border-t border-border/60 pt-3">
      <button type="button" onClick={copy} className={btn}>
        {copied ? t("marketing.action.copied") : t("marketing.action.copy")}
      </button>
    </div>
  );
}

export function TagList({ tags }: { tags: string[] }) {
  if (!tags.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((tag) => (
        <Badge key={tag} variant="outline">
          {tag.startsWith("#") ? tag : `#${tag}`}
        </Badge>
      ))}
    </div>
  );
}

export function platformAccentClass(accent: string): string {
  return ACCENT[accent] ?? ACCENT.blue;
}
