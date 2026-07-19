"use client";

export function BusinessProfileSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading business profile">
      <div className="h-16 animate-pulse rounded-xl border border-border/60 bg-surface-muted/50" />
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="space-y-3 rounded-xl border border-border/60 bg-surface p-6">
          <div className="h-5 w-40 animate-pulse rounded bg-surface-muted" />
          <div className="h-10 animate-pulse rounded-lg bg-surface-muted/70" />
          <div className="h-10 animate-pulse rounded-lg bg-surface-muted/70" />
          <div className="h-24 animate-pulse rounded-lg bg-surface-muted/70" />
        </div>
      ))}
    </div>
  );
}
