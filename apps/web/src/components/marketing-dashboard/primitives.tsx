"use client";

import { useCallback, useState } from "react";

const ACCENT: Record<string, string> = {
  blue: "border-brand-blue/30 bg-brand-blue/5 text-brand-blue",
  teal: "border-brand-teal/30 bg-brand-teal/5 text-brand-teal",
  navy: "border-navy/20 bg-navy/5 text-navy",
  amber: "border-brand-amber/30 bg-brand-amber/5 text-brand-amber",
};

export function DashboardSection({
  title,
  subtitle,
  icon,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-border bg-surface p-5 shadow-sm ${className}`}>
      <div className="mb-4 flex items-start gap-3">
        {icon && (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-navy/5 text-sm font-bold text-navy">
            {icon}
          </span>
        )}
        <div>
          <h3 className="text-sm font-semibold tracking-tight text-navy">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-ink-secondary">{subtitle}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

export function ScoreBar({ label, value, accent = "blue" }: { label: string; value: number; accent?: keyof typeof ACCENT }) {
  const color =
    accent === "teal"
      ? "bg-brand-teal"
      : accent === "navy"
        ? "bg-navy"
        : accent === "amber"
          ? "bg-brand-amber"
          : "bg-brand-blue";
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-medium text-ink-secondary">{label}</span>
        <span className="tabular-nums font-semibold text-navy">{value}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-muted">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${Math.min(100, value)}%` }} />
      </div>
    </div>
  );
}

export function MetricChip({ label, value, accent = "blue" }: { label: string; value: string; accent?: keyof typeof ACCENT }) {
  return (
    <div className={`rounded-xl border px-3 py-2 ${ACCENT[accent] ?? ACCENT.blue}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wider opacity-80">{label}</p>
      <p className="mt-0.5 text-sm font-semibold">{value}</p>
    </div>
  );
}

export function Badge({ children, variant = "default" }: { children: React.ReactNode; variant?: "default" | "outline" }) {
  return (
    <span
      className={
        variant === "outline"
          ? "inline-flex rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-ink-secondary"
          : "inline-flex rounded-full bg-brand-blue/10 px-2 py-0.5 text-[11px] font-medium text-brand-blue"
      }
    >
      {children}
    </span>
  );
}

export function StrategyField({ label, value }: { label: string; value: string }) {
  if (!value?.trim()) return null;
  return (
    <div className="rounded-xl border border-border/60 bg-surface-muted/30 px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-brand-blue">{label}</p>
      <p className="mt-1 text-sm leading-snug text-ink">{value}</p>
    </div>
  );
}

export function CopyActionBar({
  text,
  onAction,
}: {
  text: string;
  onAction?: (action: "copy" | "regenerate" | "edit" | "expand" | "shorten") => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      onAction?.("copy");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }, [text, onAction]);

  const btn =
    "rounded-lg border border-border bg-surface px-2 py-1 text-[11px] font-medium text-ink-secondary transition hover:border-brand-blue/40 hover:text-navy";

  return (
    <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border/60 pt-3">
      <button type="button" onClick={copy} className={btn}>
        {copied ? "✓ Copied" : "Copy"}
      </button>
      {(["Regenerate", "Edit", "Expand", "Shorten"] as const).map((label) => (
        <button
          key={label}
          type="button"
          className={btn}
          onClick={() => onAction?.(label.toLowerCase() as "regenerate" | "edit" | "expand" | "shorten")}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function TagList({ tags }: { tags: string[] }) {
  if (!tags.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {tags.map((t) => (
        <Badge key={t} variant="outline">
          {t.startsWith("#") ? t : `#${t}`}
        </Badge>
      ))}
    </div>
  );
}

export function platformAccentClass(accent: string): string {
  return ACCENT[accent] ?? ACCENT.blue;
}
