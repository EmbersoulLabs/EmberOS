import { eq } from "drizzle-orm";
import { applyVoicePreset } from "@ceo-agent/agents";
import { getDb, schema, requireWorkspaceRole } from "@ceo-agent/db";
import {
  isClipBgmKey,
  isClipVoicePreset,
  needsFullAudioRerender,
  recommendationForTrackId,
  type CopyLocale,
  type EditPlan,
} from "@ceo-agent/shared";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";
import { enqueuePreviewSubtitleRerender } from "@/lib/render-queue";

type ExternalBgmInput = {
  source: string;
  trackId: string;
  name: string;
  artist?: string;
  audioUrl: string;
  licenseUrl?: string;
  attribution?: string;
};

function isValidExternalBgm(value: unknown): value is ExternalBgmInput {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.source === "string" &&
    typeof v.trackId === "string" &&
    typeof v.name === "string" &&
    typeof v.audioUrl === "string" &&
    /^https?:\/\//.test(v.audioUrl)
  );
}

function patchEditPlanAudio(
  plan: EditPlan,
  input: {
    bgm?: string;
    external?: ExternalBgmInput | null;
    voicePreset?: string;
    ttsLocale?: CopyLocale;
  }
): EditPlan {
  let next: EditPlan = { ...plan, audio: { ...plan.audio } };

  // External (online) track takes priority and clears the built-in recommendation.
  if (input.external !== undefined) {
    if (input.external === null) {
      next = { ...next, audio: { ...next.audio, bgmExternal: null } };
    } else {
      next = {
        ...next,
        audio: {
          ...next.audio,
          bgm: "external",
          keepOriginal: false,
          bgmExternal: {
            source: input.external.source,
            trackId: input.external.trackId,
            name: input.external.name,
            artist: input.external.artist,
            audioUrl: input.external.audioUrl,
            licenseUrl: input.external.licenseUrl,
            attribution: input.external.attribution,
          },
          bgmRecommendation: undefined,
        },
      };
    }
  }

  if (input.bgm !== undefined && input.bgm !== "external") {
    const trackId = input.bgm === "none" ? "none" : input.bgm;
    const rec =
      trackId !== "none"
        ? recommendationForTrackId(trackId)
        : undefined;
    next = {
      ...next,
      audio: {
        ...next.audio,
        bgm: trackId,
        keepOriginal: false,
        // Selecting a built-in track clears any previously chosen online track.
        bgmExternal: null,
        bgmRecommendation: rec
          ? {
              trackId: rec.trackId,
              trackName: rec.trackName,
              category: rec.category,
              confidenceScore: rec.confidenceScore,
              reason: rec.reason,
              benefits: rec.benefits,
              alternatives: rec.alternatives,
              analysis: rec.analysis,
              license: rec.license,
            }
          : undefined,
      },
    };
  }

  if (input.voicePreset && isClipVoicePreset(input.voicePreset)) {
    next = applyVoicePreset(next, input.voicePreset);
  }

  if (input.ttsLocale === "en" || input.ttsLocale === "zh") {
    const script =
      input.ttsLocale === "zh" ? next.finalScriptZh?.trim() : next.finalScriptEn?.trim();
    if (script) {
      const voice = next.audio.voiceover?.voice ?? "female";
      const enabled = next.audio.voiceover?.enabled ?? false;
      next = {
        ...next,
        finalScript: script,
        audio: {
          ...next.audio,
          voiceover: {
            ...next.audio.voiceover,
            enabled,
            locale: input.ttsLocale,
            voice,
            segments: [{ startSec: 0, endSec: next.targetDurationSec, text: script }],
          },
        },
      };
    }
  }

  return next;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    const body = (await request.json()) as {
      bgm?: string;
      external?: ExternalBgmInput | null;
      voicePreset?: string;
      ttsLocale?: CopyLocale;
    };

    if (
      body.bgm === undefined &&
      body.external === undefined &&
      body.voicePreset === undefined &&
      body.ttsLocale === undefined
    ) {
      return apiError("No audio fields to update", "VALIDATION", 400);
    }

    if (body.external !== undefined && body.external !== null && !isValidExternalBgm(body.external)) {
      return apiError("Invalid external track", "VALIDATION", 400);
    }

    if (body.bgm !== undefined && body.bgm !== "external" && !isClipBgmKey(body.bgm)) {
      return apiError("Invalid BGM key", "VALIDATION", 400);
    }

    if (body.voicePreset !== undefined && !isClipVoicePreset(body.voicePreset)) {
      return apiError("Invalid voice preset", "VALIDATION", 400);
    }

    if (body.ttsLocale !== undefined && body.ttsLocale !== "en" && body.ttsLocale !== "zh") {
      return apiError("Invalid TTS locale", "VALIDATION", 400);
    }

    const db = getDb();
    const [creative] = await db
      .select()
      .from(schema.creatives)
      .where(eq(schema.creatives.id, id))
      .limit(1);

    if (!creative) return apiError("Creative not found", "NOT_FOUND", 404);
    await requireWorkspaceRole(creative.workspaceId, user.id, "editor");

    const previousPlan = creative.editPlan as EditPlan | null;
    if (!previousPlan) return apiError("Edit plan not found", "INVALID_STATE", 400);

    if (!creative.videoUrl && !creative.renderCachePath) {
      return apiError("Clip not ready for audio swap", "INVALID_STATE", 400);
    }

    const nextEditPlan = patchEditPlanAudio(previousPlan, body);
    const renderMode = needsFullAudioRerender(previousPlan, nextEditPlan) ? "preview" : "subtitles_only";

    const [updated] = await db
      .update(schema.creatives)
      .set({
        editPlan: nextEditPlan,
        renderStatus: "preview_rendering",
        renderProgress: {
          percent: 0,
          phase: "queued",
          mode: renderMode,
          updatedAt: new Date().toISOString(),
        },
        updatedAt: new Date(),
      })
      .where(eq(schema.creatives.id, id))
      .returning();

    if (creative.taskId) {
      try {
        await enqueuePreviewSubtitleRerender(id, renderMode);
      } catch (enqueueErr) {
        const message =
          enqueueErr instanceof Error ? enqueueErr.message : "Failed to enqueue render job";
        await db
          .update(schema.creatives)
          .set({
            renderStatus: "preview_ready",
            renderProgress: {
              percent: 0,
              phase: "queued",
              error: message,
              updatedAt: new Date().toISOString(),
            },
            updatedAt: new Date(),
          })
          .where(eq(schema.creatives.id, id));
        return apiError(message, "QUEUE_ERROR", 503);
      }
    }

    return apiSuccess({
      creative: updated,
      rerenderQueued: true,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
