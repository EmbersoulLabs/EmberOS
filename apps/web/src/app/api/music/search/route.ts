import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";

const JAMENDO_ENDPOINT = "https://api.jamendo.com/v3.0/tracks/";

type JamendoTrack = {
  id: string;
  name: string;
  artist_name?: string;
  duration?: number;
  audio?: string;
  audiodownload?: string;
  audiodownload_allowed?: boolean;
  license_ccurl?: string;
  album_image?: string;
  image?: string;
};

export type MusicSearchResult = {
  source: "jamendo";
  trackId: string;
  name: string;
  artist: string;
  durationSec: number;
  previewUrl: string;
  audioUrl: string;
  licenseUrl: string;
  attribution: string;
  image?: string;
};

/** Commercial use requires a non-NonCommercial license + downloadable audio. */
function isCommercialSafe(track: JamendoTrack): boolean {
  if (track.audiodownload_allowed === false) return false;
  if (!track.audiodownload) return false;
  const license = (track.license_ccurl ?? "").toLowerCase();
  if (!license) return false;
  // Exclude NonCommercial licenses (by-nc, by-nc-sa, by-nc-nd).
  if (license.includes("/by-nc")) return false;
  if (license.includes("nc-")) return false;
  return true;
}

export async function GET(request: Request) {
  try {
    await requireAuth();

    const clientId = process.env.JAMENDO_CLIENT_ID;
    if (!clientId) {
      return apiError("Online music search is not configured", "NOT_CONFIGURED", 501);
    }

    const url = new URL(request.url);
    const q = (url.searchParams.get("q") ?? "").trim();
    const limit = Math.min(40, Math.max(1, Number(url.searchParams.get("limit") ?? "20")));

    const params = new URLSearchParams({
      client_id: clientId,
      format: "json",
      limit: String(limit),
      audioformat: "mp32",
      audiodlallowed: "true",
      include: "licenses",
      order: q ? "relevance" : "popularity_total",
      groupby: "artist_id",
    });
    if (q) params.set("search", q);
    else params.set("tags", "corporate+upbeat+cinematic+ambient");

    const res = await fetch(`${JAMENDO_ENDPOINT}?${params.toString()}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });

    if (!res.ok) {
      return apiError(`Music provider error (${res.status})`, "PROVIDER_ERROR", 502);
    }

    const data = (await res.json()) as { results?: JamendoTrack[] };
    const results: MusicSearchResult[] = (data.results ?? [])
      .filter(isCommercialSafe)
      .map((t) => ({
        source: "jamendo" as const,
        trackId: String(t.id),
        name: t.name,
        artist: t.artist_name ?? "Unknown",
        durationSec: Math.round(t.duration ?? 0),
        previewUrl: t.audio ?? t.audiodownload ?? "",
        audioUrl: t.audiodownload ?? t.audio ?? "",
        licenseUrl: t.license_ccurl ?? "",
        attribution: `"${t.name}" by ${t.artist_name ?? "Unknown"} (Jamendo, ${
          t.license_ccurl ? "CC" : "licensed"
        })`,
        image: t.album_image ?? t.image,
      }))
      .filter((t) => t.audioUrl && t.previewUrl);

    return apiSuccess({ results });
  } catch (error) {
    return handleApiError(error);
  }
}
