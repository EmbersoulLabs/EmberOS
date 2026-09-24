"use client";

import { useEffect, useState } from "react";

export function CharacterPortrait({
  workspaceId,
  assetId,
  label,
  className = "h-40 w-full rounded-lg object-cover",
}: {
  workspaceId: string;
  assetId: string | null | undefined;
  label: string;
  className?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    if (!assetId) return;
    fetch(`/api/workspaces/${workspaceId}/library/${assetId}/preview`)
      .then(async (response) => ({ ok: response.ok, body: await response.json() }))
      .then(({ ok, body }) => {
        if (active && ok && typeof body.previewUrl === "string") setUrl(body.previewUrl);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [assetId, workspaceId]);
  if (!assetId) return <div className={`flex items-center justify-center bg-surface-muted text-xs text-ink-secondary ${className}`}>{label}</div>;
  if (!url) return <div className={`flex items-center justify-center bg-surface-muted text-xs text-ink-secondary ${className}`}>{label}</div>;
  return <img src={url} alt={label} className={className} />;
}
