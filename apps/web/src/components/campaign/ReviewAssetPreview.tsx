"use client";

import { useEffect, useState } from "react";
import { resolveAssetDisplayLabel } from "@ceo-agent/shared";
import { useI18n } from "@/lib/i18n/provider";

export type ReviewAssetPreviewModel = {
  id: string;
  type: string;
  displayName?: string | null;
  originalFilename?: string | null;
  mimeType?: string | null;
  /** Existing generated thumbnail path/URL when present in metadata. */
  thumbnailUrl?: string | null;
  metadata?: Record<string, unknown> | null;
};

function typeKind(type: string, mimeType?: string | null): "image" | "video" | "audio" | "pdf" | "other" {
  const mime = (mimeType || "").toLowerCase();
  const t = type.toLowerCase();
  if (t === "image" || mime.startsWith("image/")) return "image";
  if (t === "video" || mime.startsWith("video/")) return "video";
  if (t === "audio" || mime.startsWith("audio/")) return "audio";
  if (t === "pdf" || mime === "application/pdf") return "pdf";
  return "other";
}

function metadataThumbnail(
  metadata: Record<string, unknown> | null | undefined
): string | null {
  if (!metadata) return null;
  for (const key of ["thumbnailUrl", "posterUrl", "previewUrl", "thumbnailPath"]) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim().startsWith("http")) {
      return value.trim();
    }
  }
  return null;
}

/**
 * Minimal Review and Create asset representation (remediation Fix 5).
 * Uses existing signed download URLs / metadata thumbnails only.
 */
export function ReviewAssetPreview({
  workspaceId,
  asset,
}: {
  workspaceId: string;
  asset: ReviewAssetPreviewModel;
}) {
  const { t } = useI18n();
  const kind = typeKind(asset.type, asset.mimeType);
  const label = resolveAssetDisplayLabel(asset);
  const [imageUrl, setImageUrl] = useState<string | null>(
    asset.thumbnailUrl || metadataThumbnail(asset.metadata)
  );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadImagePreview() {
      if (kind !== "image") return;
      if (imageUrl) return;
      try {
        const res = await fetch(
          `/api/workspaces/${workspaceId}/library/${asset.id}/download-url`
        );
        const data = await res.json();
        if (!cancelled && res.ok && typeof data.downloadUrl === "string") {
          setImageUrl(data.downloadUrl);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    }
    void loadImagePreview();
    return () => {
      cancelled = true;
    };
  }, [asset.id, imageUrl, kind, workspaceId]);

  const videoThumb = kind === "video" ? metadataThumbnail(asset.metadata) : null;
  const pdfThumb = kind === "pdf" ? metadataThumbnail(asset.metadata) : null;

  return (
    <li className="flex gap-3 rounded-lg border border-border px-3 py-2 text-sm">
      <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-muted text-[10px] font-semibold uppercase text-ink-secondary">
        {kind === "image" && imageUrl && !failed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt=""
            className="h-full w-full object-cover"
            onError={() => setFailed(true)}
          />
        ) : kind === "video" && videoThumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={videoThumb} alt="" className="h-full w-full object-cover" />
        ) : kind === "pdf" && pdfThumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={pdfThumb} alt="" className="h-full w-full object-cover" />
        ) : (
          <span>
            {kind === "image"
              ? t("campaign.review.previewImage")
              : kind === "video"
                ? t("campaign.review.previewVideo")
                : kind === "audio"
                  ? t("campaign.review.previewAudio")
                  : kind === "pdf"
                    ? t("campaign.review.previewPdf")
                    : t("campaign.review.previewFile")}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-navy">{label}</p>
        {asset.originalFilename &&
        asset.displayName &&
        asset.displayName !== asset.originalFilename ? (
          <p className="truncate text-xs text-ink-secondary">{asset.originalFilename}</p>
        ) : null}
        <p className="text-xs text-ink-secondary">{asset.type}</p>
      </div>
    </li>
  );
}
