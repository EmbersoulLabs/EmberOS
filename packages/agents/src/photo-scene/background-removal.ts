import { PhotoSceneExtractionError } from "@ceo-agent/shared";
import { encodeRgbaPng } from "./png";
import { createPhotoroomProvider } from "./providers/photoroom";

export type BackgroundRemovalInput = {
  bytes: Buffer;
  mimeType: string;
  sourceAssetId: string;
  workspaceId: string;
};

export type BackgroundRemovalOutput = {
  bytes: Buffer;
  mimeType: "image/png";
  width: number;
  height: number;
  costUsd: number | null;
  providerKey: string;
};

export interface BackgroundRemovalProvider {
  readonly key: string;
  removeBackground(input: BackgroundRemovalInput): Promise<BackgroundRemovalOutput>;
}

function deterministicCutoutPng(): Buffer {
  const width = 8;
  const height = 8;
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const opaque = x < 5 && y < 6;
      rgba[i] = 198;
      rgba[i + 1] = 40;
      rgba[i + 2] = 40;
      rgba[i + 3] = opaque ? 255 : 0;
    }
  }
  return encodeRgbaPng(width, height, rgba);
}

export class DeterministicBackgroundRemovalProvider implements BackgroundRemovalProvider {
  readonly key = "deterministic";

  async removeBackground(_input: BackgroundRemovalInput): Promise<BackgroundRemovalOutput> {
    if (process.env.PHOTO_SCENE_DETERMINISTIC_FAIL === "true") {
      throw new PhotoSceneExtractionError(
        "PROVIDER_UNAVAILABLE",
        "Deterministic certification failure"
      );
    }
    const bytes = deterministicCutoutPng();
    return {
      bytes,
      mimeType: "image/png",
      width: 8,
      height: 8,
      costUsd: 0,
      providerKey: this.key,
    };
  }
}

export class UnavailableBackgroundRemovalProvider implements BackgroundRemovalProvider {
  readonly key = "none";

  async removeBackground(_input: BackgroundRemovalInput): Promise<BackgroundRemovalOutput> {
    throw new PhotoSceneExtractionError(
      "PROVIDER_UNAVAILABLE",
      "Background removal provider is not configured"
    );
  }
}

export function isDeterministicProviderAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PHOTO_SCENE_ALLOW_DETERMINISTIC_PROVIDER === "true";
}

export function resolveBackgroundRemovalProvider(
  env: NodeJS.ProcessEnv = process.env,
  injected?: BackgroundRemovalProvider
): BackgroundRemovalProvider {
  if (injected) return injected;
  const name = (env.PHOTO_SCENE_BACKGROUND_REMOVAL_PROVIDER ?? "none").trim().toLowerCase();
  if (name === "deterministic") {
    if (env.NODE_ENV === "production" || !isDeterministicProviderAllowed(env)) {
      return new UnavailableBackgroundRemovalProvider();
    }
    return new DeterministicBackgroundRemovalProvider();
  }
  if (name === "photoroom") {
    try {
      return createPhotoroomProvider(env);
    } catch {
      return new UnavailableBackgroundRemovalProvider();
    }
  }
  return new UnavailableBackgroundRemovalProvider();
}

/** Production default cannot select the CI/test adapter. */
export function productionCanAccidentallyUseTestAdapter(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (env.NODE_ENV !== "production") return false;
  return resolveBackgroundRemovalProvider(env).key === "deterministic";
}
