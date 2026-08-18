"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DashboardSection } from "@/components/marketing-dashboard/primitives";
import { readPhotoSceneMetadata } from "@ceo-agent/shared";

type CampaignAsset = Record<string, unknown>;

type GenerationDto = {
  id: string;
  status: string;
  sourceAssetId: string;
  outputAssetId: string | null;
  reused?: boolean;
  boundedError?: string | null;
  previewUrl?: string;
  attemptCount?: number;
};

function assetName(asset: CampaignAsset): string {
  const meta = asset.metadata as { originalFilename?: string } | undefined;
  if (meta?.originalFilename) return meta.originalFilename;
  return String(asset.storagePath ?? "").split("/").pop() ?? "image";
}

function isProductImage(asset: CampaignAsset): boolean {
  if (asset.type !== "image") return false;
  const role = readPhotoSceneMetadata((asset.metadata as Record<string, unknown> | undefined) ?? undefined)
    ?.role;
  return !role || role === "product_source";
}

export function PhotoSceneExtractionPanel({
  campaignId,
  assets,
}: {
  campaignId: string;
  assets: CampaignAsset[];
}) {
  const images = assets.filter(isProductImage);
  const [sourceAssetId, setSourceAssetId] = useState<string>(
    (images[0]?.id as string | undefined) ?? ""
  );
  const [generation, setGeneration] = useState<GenerationDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadLatest = useCallback(async () => {
    const res = await fetch(`/api/campaigns/${campaignId}/photo-scene/extractions`);
    if (!res.ok) return;
    const body = (await res.json()) as { generation?: GenerationDto | null };
    if (body.generation) {
      setGeneration(body.generation);
      if (body.generation.sourceAssetId) setSourceAssetId(body.generation.sourceAssetId);
    }
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

  async function startExtraction(assetId: string) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/photo-scene/extractions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceAssetId: assetId }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Could not extract this product image. Try again or choose another image.");
        return;
      }
      setGeneration(body as GenerationDto);
      setSourceAssetId(assetId);
    } finally {
      setBusy(false);
    }
  }

  async function retry() {
    if (!generation?.id) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/photo-scene/generations/${generation.id}/retry`, {
        method: "POST",
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Could not extract this product image. Try again or choose another image.");
        return;
      }
      setGeneration(body as GenerationDto);
    } finally {
      setBusy(false);
    }
  }

  async function uploadSource(file: File) {
    setUploading(true);
    setError("");
    try {
      const urlRes = await fetch(`/api/campaigns/${campaignId}/assets/upload-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          mimeType: file.type || "image/png",
          type: "image",
          fileSizeBytes: file.size,
        }),
      });
      const urlBody = await urlRes.json();
      if (!urlRes.ok) {
        setError(urlBody.error ?? "Could not upload this image.");
        return;
      }
      const put = await fetch(urlBody.uploadUrl as string, {
        method: "PUT",
        headers: { "Content-Type": file.type || "image/png" },
        body: file,
      });
      if (!put.ok) {
        setError("Could not upload this image.");
        return;
      }
      await fetch(`/api/campaigns/${campaignId}/assets/${urlBody.assetId}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      setSourceAssetId(urlBody.assetId as string);
      await startExtraction(urlBody.assetId as string);
    } finally {
      setUploading(false);
    }
  }

  const processing = generation?.status === "queued" || generation?.status === "processing";

  return (
    <DashboardSection
      title="Photo Scene — Product extraction"
      subtitle="Extract a transparent product PNG from a campaign image"
    >
      <div className="space-y-4 px-4 py-4 sm:px-5">
        <label className="block text-sm font-medium text-navy">
          Product source
          <select
            className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm"
            value={sourceAssetId}
            onChange={(event) => setSourceAssetId(event.target.value)}
            disabled={busy || uploading}
          >
            <option value="">Select an image</option>
            {images.map((asset) => (
              <option key={asset.id as string} value={asset.id as string}>
                {assetName(asset)}
              </option>
            ))}
            {sourceAssetId && !images.some((asset) => asset.id === sourceAssetId) ? (
              <option value={sourceAssetId}>Uploaded image</option>
            ) : null}
          </select>
        </label>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || uploading || !sourceAssetId || processing}
            onClick={() => void startExtraction(sourceAssetId)}
            className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            Start extraction
          </button>
          <button
            type="button"
            disabled={busy || uploading}
            onClick={() => fileRef.current?.click()}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-navy"
          >
            {uploading ? "Uploading…" : "Change / re-upload source"}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void uploadSource(file);
            }}
          />
        </div>

        {processing && (
          <p className="text-sm text-ink-secondary">Extracting product… this uses saved server state.</p>
        )}

        {generation?.status === "ready" && generation.previewUrl && (
          <div className="space-y-2">
            {generation.reused ? (
              <p className="text-sm text-ink-secondary">Existing extracted product reused.</p>
            ) : (
              <p className="text-sm text-ink-secondary">Extracted product is ready.</p>
            )}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={generation.previewUrl}
              alt="Extracted product"
              className="max-h-64 rounded-lg border border-border bg-[linear-gradient(45deg,#eee_25%,transparent_25%,transparent_75%,#eee_75%),linear-gradient(45deg,#eee_25%,transparent_25%,transparent_75%,#eee_75%)] bg-[length:16px_16px] bg-[position:0_0,8px_8px]"
            />
          </div>
        )}

        {(generation?.status === "failed" || error) && (
          <div className="space-y-2">
            <p className="text-sm text-red-700">
              {error ||
                generation?.boundedError ||
                "Could not extract this product image. Try again or choose another image."}
            </p>
            {generation?.status === "failed" && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void retry()}
                className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700"
              >
                Retry
              </button>
            )}
          </div>
        )}
      </div>
    </DashboardSection>
  );
}
