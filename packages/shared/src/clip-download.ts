import type { ClipDownloadResolution } from "./render";

const RENDITIONS_KEY = "_renditions";

export type RenditionState = {
  ready: boolean;
  url?: string;
  status: "ready" | "none" | "rendering" | "failed";
  percent?: number;
  error?: string;
};

export function readStoredRenditions(
  platformAdaptations: Record<string, unknown> | null | undefined
): Partial<Record<ClipDownloadResolution, string>> {
  const raw = platformAdaptations?.[RENDITIONS_KEY];
  if (!raw || typeof raw !== "object") return {};
  const out: Partial<Record<ClipDownloadResolution, string>> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if ((k === "2k" || k === "1080p" || k === "720p") && typeof v === "string" && v) {
      out[k] = v;
    }
  }
  return out;
}

export function mergeStoredRendition(
  platformAdaptations: Record<string, unknown> | null | undefined,
  resolution: ClipDownloadResolution,
  url: string
): Record<string, unknown> {
  const base = { ...(platformAdaptations ?? {}) };
  const renditions = { ...readStoredRenditions(base), [resolution]: url };
  return { ...base, [RENDITIONS_KEY]: renditions };
}

export function pickCreativeVideoUrl(
  creative: {
    videoUrl?: string | null;
    videoExportUrl?: string | null;
    platformAdaptations?: Record<string, unknown> | null;
  },
  resolution: ClipDownloadResolution
): string | null {
  if (resolution === "720p") return creative.videoUrl ?? null;
  if (resolution === "1080p") return creative.videoExportUrl ?? null;
  return readStoredRenditions(creative.platformAdaptations ?? null)["2k"] ?? null;
}

export function buildRenditionStates(input: {
  videoUrl?: string | null;
  videoExportUrl?: string | null;
  platformAdaptations?: Record<string, unknown> | null;
  renderStatus?: string | null;
  renderProgress?: {
    rendition?: string;
    percent?: number;
    error?: string;
    phase?: string;
  } | null;
}): Record<ClipDownloadResolution, RenditionState> {
  const progress = input.renderProgress;
  const activeRendition = progress?.rendition as ClipDownloadResolution | undefined;
  const isRendering =
    activeRendition &&
    progress?.phase !== "done" &&
    !progress?.error &&
    (progress?.percent ?? 0) < 100;

  function stateFor(res: ClipDownloadResolution): RenditionState {
    const url = pickCreativeVideoUrl(
      {
        videoUrl: input.videoUrl,
        videoExportUrl: input.videoExportUrl,
        platformAdaptations: input.platformAdaptations,
      },
      res
    );
    if (url) return { ready: true, url, status: "ready" };
    if (isRendering && activeRendition === res) {
      return {
        ready: false,
        status: "rendering",
        percent: progress?.percent ?? 0,
      };
    }
    if (progress?.error && activeRendition === res) {
      return { ready: false, status: "failed", error: progress.error };
    }
    if (res === "1080p" && input.renderStatus === "final_rendering") {
      return { ready: false, status: "rendering", percent: progress?.percent ?? 0 };
    }
    return { ready: false, status: "none" };
  }

  return {
    "720p": stateFor("720p"),
    "1080p": stateFor("1080p"),
    "2k": stateFor("2k"),
  };
}
