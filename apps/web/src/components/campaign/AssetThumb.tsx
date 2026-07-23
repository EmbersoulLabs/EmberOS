"use client";

import { useEffect, useState } from "react";
import { resolveAssetDisplayLabel } from "@ceo-agent/shared";
import { useI18n } from "@/lib/i18n/provider";

export type AssetThumbModel = {
  id: string;
  type: string;
  displayName?: string | null;
  originalFilename?: string | null;
  mimeType?: string | null;
  metadata?: Record<string, unknown> | null;
  /** Local blob URL while upload is in progress. */
  localPreviewUrl?: string | null;
};

function kindOf(
  type: string,
  mimeType?: string | null
): "image" | "video" | "audio" | "pdf" | "other" {
  const mime = (mimeType || "").toLowerCase();
  const t = type.toLowerCase();
  if (t === "image" || mime.startsWith("image/")) return "image";
  if (t === "video" || mime.startsWith("video/")) return "video";
  if (t === "audio" || mime.startsWith("audio/")) return "audio";
  if (t === "pdf" || mime === "application/pdf") return "pdf";
  return "other";
}

function metadataThumb(metadata: Record<string, unknown> | null | undefined): string | null {
  if (!metadata) return null;
  for (const key of ["thumbnailUrl", "posterUrl", "previewUrl", "thumbnailPath"]) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim().startsWith("http")) return value.trim();
  }
  return null;
}

/** Shared image/video preview for Asset Library and Campaign upload (QA-003/004). */
export function AssetThumb({
  workspaceId,
  asset,
  className = "h-14 w-14",
}: {
  workspaceId: string;
  asset: AssetThumbModel;
  className?: string;
}) {
  const { t } = useI18n();
  const kind = kindOf(asset.type, asset.mimeType);
  const metaThumb = metadataThumb(asset.metadata);
  const [remoteUrl, setRemoteUrl] = useState<string | null>(metaThumb);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (asset.localPreviewUrl) return;
      if (metaThumb) {
        setRemoteUrl(metaThumb);
        return;
      }
      if (kind !== "image" && kind !== "video") return;
      try {
        const res = await fetch(
          `/api/workspaces/${workspaceId}/library/${asset.id}/download-url`
        );
        const data = await res.json();
        if (!cancelled && res.ok && typeof data.downloadUrl === "string") {
          setRemoteUrl(data.downloadUrl);
        } else if (!cancelled) {
          setFailed(true);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [asset.id, asset.localPreviewUrl, kind, metaThumb, workspaceId]);

  const src = asset.localPreviewUrl || remoteUrl;
  const label =
    kind === "image"
      ? t("campaign.review.previewImage")
      : kind === "video"
        ? t("campaign.review.previewVideo")
        : kind === "audio"
          ? t("campaign.review.previewAudio")
          : kind === "pdf"
            ? t("campaign.review.previewPdf")
            : t("campaign.review.previewFile");

  return (
    <div
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-muted text-[10px] font-semibold uppercase text-ink-secondary ${className}`}
      title={resolveAssetDisplayLabel(asset)}
    >
      {kind === "image" && src && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : kind === "video" && src && !failed ? (
        <video
          src={src}
          muted
          playsInline
          preload="metadata"
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : kind === "video" && metaThumb && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={metaThumb} alt="" className="h-full w-full object-cover" />
      ) : (
        <span>{label}</span>
      )}
    </div>
  );
}
