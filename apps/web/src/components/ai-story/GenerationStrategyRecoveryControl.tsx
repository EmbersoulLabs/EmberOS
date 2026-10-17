"use client";

import { useState } from "react";

export function GenerationStrategyRecoveryControl({
  campaignId,
  storyId,
  disabled,
  onRecovered,
  onError,
}: {
  campaignId: string;
  storyId: string;
  disabled?: boolean;
  onRecovered: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [pending, setPending] = useState(false);
  const [recovered, setRecovered] = useState(false);
  async function recover() {
    if (pending) return;
    setPending(true);
    onError("");
    try {
      const response = await fetch(`/api/campaigns/${encodeURIComponent(campaignId)}/ai-stories/${encodeURIComponent(storyId)}/planning/strategy-successor`, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Generation strategy recovery failed");
      await onRecovered();
      setRecovered(true);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Generation strategy recovery failed");
    } finally {
      setPending(false);
    }
  }
  if (recovered) return null;
  return (
    <section className="rounded-lg border border-amber-200 bg-amber-50 p-3" data-testid="generation-strategy-recovery">
      <p className="text-sm font-medium text-amber-950">Historical generation strategy</p>
      <p className="mt-1 text-sm text-amber-900">Create an immutable successor from the existing approved creative facts and references. This makes no AI call and still requires Planning approval.</p>
      <button type="button" disabled={disabled || pending} onClick={() => void recover()} className="mt-3 rounded-lg border border-amber-400 bg-white px-3 py-2 text-sm font-medium text-amber-950 disabled:opacity-60">
        {pending ? "Preparing successor…" : "Prepare strategy successor"}
      </button>
    </section>
  );
}
