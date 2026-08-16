import { STORAGE_PATHS, type TaskExportResolution } from "@ceo-agent/shared";
import { createAdminClient } from "@/lib/supabase/admin";

export const VIDEO_ARTIFACT_SIGNED_URL_TTL_SECONDS = 10 * 60;

type CreativeArtifactRow = {
  id: string;
  workspaceId: string;
  campaignId: string;
  videoUrl?: string | null;
  videoExportUrl?: string | null;
  coverUrl?: string | null;
  platformAdaptations?: Record<string, unknown> | null;
  [key: string]: unknown;
};

type Signer = (objectKey: string, options?: { download?: string }) => Promise<string>;

function configuredBucket(): string {
  return process.env.SUPABASE_STORAGE_BUCKET ?? "campaign-assets";
}

/**
 * Accept a new stable object key or the exact historical public URL for that
 * same key. Arbitrary URLs and client-selected object keys fail closed.
 */
export function resolveExpectedVideoArtifactKey(
  reference: string,
  expectedObjectKey: string,
  config: { baseUrl?: string; bucket?: string } = {}
): string {
  if (reference === expectedObjectKey) return expectedObjectKey;
  const baseUrl = (config.baseUrl ?? process.env.NEXT_PUBLIC_SUPABASE_URL)?.replace(/\/$/, "");
  const bucket = config.bucket ?? configuredBucket();
  if (!baseUrl) throw new Error("Supabase storage not configured");
  const historicalUrl = `${baseUrl}/storage/v1/object/public/${bucket}/${expectedObjectKey}`;
  if (reference === historicalUrl) return expectedObjectKey;
  throw new Error("Invalid or unauthorized Video Studio artifact reference");
}

async function defaultSigner(
  objectKey: string,
  options?: { download?: string }
): Promise<string> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.storage
    .from(configuredBucket())
    .createSignedUrl(
      objectKey,
      VIDEO_ARTIFACT_SIGNED_URL_TTL_SECONDS,
      options?.download ? { download: options.download } : undefined
    );
  if (error || !data?.signedUrl) {
    throw new Error("Unable to authorize artifact delivery");
  }
  return data.signedUrl;
}

export async function signExpectedVideoArtifact(
  reference: string,
  expectedObjectKey: string,
  options?: { download?: string; signer?: Signer }
): Promise<string> {
  const objectKey = resolveExpectedVideoArtifactKey(reference, expectedObjectKey);
  return (options?.signer ?? defaultSigner)(objectKey, { download: options?.download });
}

/** Replace durable Creative references with request-scoped delivery URLs. */
export async function withSignedCreativeArtifacts<T extends CreativeArtifactRow>(
  creative: T,
  signer?: Signer
): Promise<T> {
  const sign = (reference: string, expected: string) =>
    signExpectedVideoArtifact(reference, expected, { signer });
  const next = { ...creative };

  if (creative.videoUrl) {
    next.videoUrl = await sign(
      creative.videoUrl,
      STORAGE_PATHS.preview(creative.workspaceId, creative.campaignId, creative.id)
    );
  }
  if (creative.videoExportUrl) {
    next.videoExportUrl = await sign(
      creative.videoExportUrl,
      STORAGE_PATHS.export(creative.workspaceId, creative.campaignId, creative.id)
    );
  }
  if (creative.coverUrl) {
    next.coverUrl = await sign(
      creative.coverUrl,
      STORAGE_PATHS.cover(creative.workspaceId, creative.campaignId, creative.id)
    );
  }

  const adaptations = creative.platformAdaptations
    ? { ...creative.platformAdaptations }
    : null;
  const renditions = adaptations?._renditions;
  if (renditions && typeof renditions === "object" && !Array.isArray(renditions)) {
    const nextRenditions = { ...(renditions as Record<string, unknown>) };
    const twoK = nextRenditions["2k"];
    if (typeof twoK === "string" && twoK) {
      nextRenditions["2k"] = await sign(
        twoK,
        STORAGE_PATHS.export2k(creative.workspaceId, creative.campaignId, creative.id)
      );
    }
    adaptations!._renditions = nextRenditions;
    next.platformAdaptations = adaptations;
  }
  return next;
}

export async function signCreativeDownload(
  creative: CreativeArtifactRow,
  resolution: "720p" | "1080p" | "2k",
  reference: string,
  signer?: Signer
): Promise<string> {
  const expected =
    resolution === "2k"
      ? STORAGE_PATHS.export2k(creative.workspaceId, creative.campaignId, creative.id)
      : resolution === "1080p"
        ? STORAGE_PATHS.export(creative.workspaceId, creative.campaignId, creative.id)
        : STORAGE_PATHS.preview(creative.workspaceId, creative.campaignId, creative.id);
  return signExpectedVideoArtifact(reference, expected, {
    download: `video-${creative.id}-${resolution}.mp4`,
    signer,
  });
}

export async function signTaskExportPack(
  input: {
    taskId: string;
    workspaceId: string;
    campaignId: string;
    resolution: TaskExportResolution;
    reference: string;
    filename?: string;
  },
  signer?: Signer
): Promise<string> {
  return signExpectedVideoArtifact(
    input.reference,
    STORAGE_PATHS.taskExportPack(
      input.workspaceId,
      input.campaignId,
      input.taskId,
      input.resolution
    ),
    { download: input.filename ?? `video-studio-${input.resolution}.zip`, signer }
  );
}

export async function signCreativeExportPack(
  input: {
    creativeId: string;
    workspaceId: string;
    campaignId: string;
    reference: string;
  },
  signer?: Signer
): Promise<string> {
  return signExpectedVideoArtifact(
    input.reference,
    STORAGE_PATHS.exportPack(input.workspaceId, input.campaignId, input.creativeId),
    { download: `video-studio-${input.creativeId}.zip`, signer }
  );
}

/** Sign only known export-pack references inside the task read model. */
export async function withSignedTaskExportProgress(
  progress: Record<string, unknown> | null | undefined,
  authority: { taskId: string; workspaceId: string; campaignId: string },
  signer?: Signer
): Promise<Record<string, unknown>> {
  const next = { ...(progress ?? {}) };
  const packs = next.export_packs;
  if (packs && typeof packs === "object" && !Array.isArray(packs)) {
    const nextPacks: Record<string, unknown> = { ...(packs as Record<string, unknown>) };
    for (const resolution of ["720p", "1080p", "2k"] as const) {
      const step = nextPacks[resolution];
      if (!step || typeof step !== "object" || Array.isArray(step)) continue;
      const output = (step as { output?: unknown }).output;
      if (!output || typeof output !== "object" || Array.isArray(output)) continue;
      const reference = (output as { exportPackUrl?: unknown }).exportPackUrl;
      if (typeof reference !== "string" || !reference) continue;
      const filename = (output as { filename?: unknown }).filename;
      nextPacks[resolution] = {
        ...(step as Record<string, unknown>),
        output: {
          ...(output as Record<string, unknown>),
          exportPackUrl: await signTaskExportPack(
            {
              ...authority,
              resolution,
              reference,
              filename: typeof filename === "string" ? filename : undefined,
            },
            signer
          ),
        },
      };
    }
    next.export_packs = nextPacks;
  }
  const legacy = next.export_pack;
  if (legacy && typeof legacy === "object" && !Array.isArray(legacy)) {
    const output = (legacy as { output?: unknown }).output;
    if (output && typeof output === "object" && !Array.isArray(output)) {
      const reference = (output as { exportPackUrl?: unknown }).exportPackUrl;
      const resolution = (output as { resolution?: unknown }).resolution;
      if (
        typeof reference === "string" &&
        (resolution === "720p" || resolution === "1080p" || resolution === "2k")
      ) {
        const filename = (output as { filename?: unknown }).filename;
        next.export_pack = {
          ...(legacy as Record<string, unknown>),
          output: {
            ...(output as Record<string, unknown>),
            exportPackUrl: await signTaskExportPack(
              {
                ...authority,
                resolution,
                reference,
                filename: typeof filename === "string" ? filename : undefined,
              },
              signer
            ),
          },
        };
      }
    }
  }
  return next;
}
