"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CLIP_DOWNLOAD_RESOLUTIONS,
  type ClipDownloadResolution,
  type RenditionState,
} from "@ceo-agent/shared";
import { useI18n } from "@/lib/i18n/provider";

type DownloadState = {
  renditions: Record<ClipDownloadResolution, RenditionState>;
  canDownload1080p: boolean;
  canDownload2k: boolean;
  exportPaywallEnabled: boolean;
  hasPreview: boolean;
};

export function ClipDownloadMenu({
  creativeId,
  clipLabel,
  compact = false,
}: {
  creativeId: string;
  clipLabel?: string;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const [resolution, setResolution] = useState<ClipDownloadResolution>("720p");
  const [state, setState] = useState<DownloadState | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/creatives/${creativeId}/download`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? t("error.generic"));
    setState({
      renditions: data.renditions,
      canDownload1080p: Boolean(data.canDownload1080p),
      canDownload2k: Boolean(data.canDownload2k),
      exportPaywallEnabled: Boolean(data.exportPaywallEnabled),
      hasPreview: Boolean(data.hasPreview),
    });
    return data.renditions as Record<ClipDownloadResolution, RenditionState>;
  }, [creativeId, t]);

  useEffect(() => {
    void load().catch(() => {});
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [load]);

  function canSelect(res: ClipDownloadResolution): boolean {
    if (res === "720p") return true;
    if (res === "1080p") return state?.canDownload1080p ?? true;
    return state?.canDownload2k ?? true;
  }

  const rendition = state?.renditions[resolution];
  const isRendering = rendition?.status === "rendering";
  const isReady = Boolean(rendition?.url);

  function startPoll() {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => {
      void load()
        .then((renditions) => {
          const r = renditions[resolution];
          if (r?.ready || r?.status === "failed") {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            setWorking(false);
            if (r.status === "failed") setError(r.error ?? t("creative.download.failed"));
          }
        })
        .catch(() => {});
    }, 2000);
  }

  async function handleDownload() {
    setError("");
    setWorking(true);
    try {
      const current = state?.renditions[resolution];
      if (current?.url) {
        triggerBrowserDownload(current.url, resolution);
        setWorking(false);
        return;
      }

      const res = await fetch(`/api/creatives/${creativeId}/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolution }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? t("creative.download.failed"));
        setWorking(false);
        return;
      }

      if (data.status === "ready" && data.url) {
        triggerBrowserDownload(data.url as string, resolution);
        setWorking(false);
        await load();
        return;
      }

      startPoll();
    } catch {
      setError(t("creative.download.failed"));
      setWorking(false);
    }
  }

  function triggerBrowserDownload(url: string, res: ClipDownloadResolution) {
    const name = clipLabel ? `${clipLabel}_${res}.mp4` : `clip_${creativeId.slice(0, 8)}_${res}.mp4`;
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.rel = "noopener";
    a.target = "_blank";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  if (!state?.hasPreview) return null;

  return (
    <div className={compact ? "space-y-1.5" : "space-y-2 rounded-lg border border-border bg-surface-muted/30 p-2.5"}>
      {!compact && (
        <p className="text-[10px] font-medium uppercase tracking-wide text-ink-secondary">
          {t("creative.download.title")}
        </p>
      )}
      <div className="flex items-center gap-1.5">
        <select
          value={resolution}
          disabled={working || isRendering}
          onChange={(e) => setResolution(e.target.value as ClipDownloadResolution)}
          className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 py-1.5 text-xs font-medium text-navy disabled:opacity-60"
        >
          {CLIP_DOWNLOAD_RESOLUTIONS.map((res) => (
            <option key={res} value={res} disabled={!canSelect(res)}>
              {t(`creative.download.${res}` as "creative.download.720p")}
              {state.exportPaywallEnabled && res !== "720p" && !canSelect(res)
                ? ` (${t("pipeline.exportUpgradeRequired")})`
                : ""}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={working || isRendering || !canSelect(resolution)}
          onClick={() => void handleDownload()}
          className="shrink-0 rounded-lg bg-navy px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-navy/90 disabled:opacity-50"
        >
          {working || isRendering
            ? t("creative.download.rendering", {
                percent: String(rendition?.percent ?? 0),
              })
            : isReady
              ? t("creative.download.cta")
              : t("creative.download.prepare")}
        </button>
      </div>
      {isRendering && (
        <div className="h-1 overflow-hidden rounded-full bg-border">
          <div
            className="h-full rounded-full bg-brand-blue transition-all"
            style={{ width: `${Math.min(100, rendition?.percent ?? 5)}%` }}
          />
        </div>
      )}
      {error && <p className="text-[10px] text-red-600">{error}</p>}
    </div>
  );
}
