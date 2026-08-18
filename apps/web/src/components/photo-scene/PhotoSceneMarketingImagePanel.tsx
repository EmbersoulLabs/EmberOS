"use client";

import { useCallback, useEffect, useState } from "react";
import { DashboardSection } from "@/components/marketing-dashboard/primitives";

type GenerationDto = {
  id: string;
  status: string;
  outputAssetId: string | null;
  boundedError?: string | null;
  previewUrl?: string;
  downloadUrl?: string;
  attemptCount?: number;
  costUsd?: string | null;
};

export function PhotoSceneMarketingImagePanel({ campaignId }: { campaignId: string }) {
  const [generation, setGeneration] = useState<GenerationDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const loadLatest = useCallback(async () => {
    const res = await fetch(`/api/campaigns/${campaignId}/photo-scene/marketing-images`);
    if (!res.ok) return;
    const body = (await res.json()) as { generation?: GenerationDto | null };
    setGeneration(body.generation ?? null);
  }, [campaignId]);

  useEffect(() => {
    void loadLatest();
  }, [loadLatest]);

  useEffect(() => {
    if (!generation || (generation.status !== "queued" && generation.status !== "processing")) {
      return;
    }
    const interval = setInterval(async () => {
      const res = await fetch(`/api/photo-scene/generations/${generation.id}`);
      if (!res.ok) return;
      const next = (await res.json()) as GenerationDto;
      setGeneration(next);
    }, 2500);
    return () => clearInterval(interval);
  }, [generation?.id, generation?.status]);

  async function generate(generateAgain = false) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/photo-scene/marketing-images`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generateAgain }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Could not generate this marketing image.");
        return;
      }
      setGeneration(body as GenerationDto);
    } finally {
      setBusy(false);
    }
  }

  async function retry() {
    if (!generation?.id) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/photo-scene/generations/${generation.id}/retry`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Could not retry this marketing image.");
        return;
      }
      setGeneration(body as GenerationDto);
    } finally {
      setBusy(false);
    }
  }

  const processing = generation?.status === "queued" || generation?.status === "processing";

  return (
    <DashboardSection
      title="Photo Scene — Marketing image"
      subtitle="Deterministic composition from the extracted product, official scene, and frozen brand/package snapshots. Not AI image generation."
    >
      <div className="space-y-4 px-4 py-4 sm:px-5">
        <p className="rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm text-ink-secondary">
          Uses the saved official scene and placement. Photoroom is not called for this step.
        </p>

        {generation?.status === "ready" && generation.previewUrl ? (
          <div className="space-y-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={generation.previewUrl}
              alt="Marketing image preview"
              className="max-h-96 rounded-lg border border-border"
            />
            {generation.downloadUrl ? (
              <a
                href={generation.downloadUrl}
                className="inline-flex rounded-lg border border-border px-3 py-2 text-sm font-medium text-navy"
              >
                Download marketing image
              </a>
            ) : null}
            <p className="text-xs text-ink-secondary">
              Saved to Campaign Assets. Composition cost $0. Refreshing this page recovers the same result.
            </p>
          </div>
        ) : null}

        {processing ? (
          <p className="text-sm text-ink-secondary">Composing marketing image… status comes from the saved generation.</p>
        ) : null}

        {generation?.status === "failed" ? (
          <p className="text-sm text-red-700">
            {generation.boundedError ?? "Could not generate this marketing image. Try again or change the scene."}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || processing}
            onClick={() => void generate(false)}
            className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            Generate marketing image
          </button>
          {generation?.status === "failed" ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void retry()}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-navy disabled:opacity-60"
            >
              Retry composition
            </button>
          ) : null}
          {generation?.status === "ready" ? (
            <button
              type="button"
              disabled={busy || processing}
              onClick={() => void generate(true)}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-navy disabled:opacity-60"
            >
              Generate again
            </button>
          ) : null}
        </div>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
      </div>
    </DashboardSection>
  );
}
