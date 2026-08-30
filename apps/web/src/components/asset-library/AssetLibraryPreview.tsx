"use client";

import { useEffect, useState } from "react";

export type AssetLibraryPreviewModel = { id: string; type: string; mimeType?: string | null };

export function AssetLibraryPreview({ workspaceId, asset, className = "h-28 w-full" }: {
  workspaceId: string; asset: AssetLibraryPreviewModel; className?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setUrl(null); setFailed(false);
    if (asset.type !== "image" && asset.type !== "video") return;
    fetch(`/api/workspaces/${workspaceId}/library/${asset.id}/download-url`)
      .then(async (response) => ({ ok: response.ok, body: await response.json() }))
      .then(({ ok, body }) => { if (active && ok && typeof body.downloadUrl === "string") setUrl(body.downloadUrl); else if (active) setFailed(true); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [asset.id, asset.type, workspaceId]);
  if (asset.type === "image" && url && !failed) return <img src={url} alt="" className={`${className} object-cover`} onError={() => setFailed(true)} />;
  if (asset.type === "video" && url && !failed) return <video src={url} muted controls preload="metadata" className={`${className} object-cover`} onError={() => setFailed(true)} />;
  return <div className={`flex items-center justify-center bg-surface-muted text-xs font-semibold uppercase text-ink-secondary ${className}`}>{asset.type}</div>;
}

