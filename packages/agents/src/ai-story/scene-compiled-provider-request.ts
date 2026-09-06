import type {
  AiStoryCompiledProviderRequest,
  AiStorySceneCompiledInstructions,
  AiStorySceneExecutionIntent,
} from "@ceo-agent/shared";
import {
  AiStoryProviderRuntimeError,
  compileImmutableSeedanceRequestFromSceneCompilation,
  type PersistedSceneProviderCompilationAuthority,
  type AiStoryReferenceAssetAuthority,
} from "./provider-runtime-dispatch-integration";
import type {
  PreparedSceneFrameAuthority,
  SceneInputPreparationAuthority,
} from "./scene-input-preparation";

export function compileImmutableSceneProviderRequest(input: {
  readonly providerId: string;
  readonly adapterVersion: string;
  readonly intent: AiStorySceneExecutionIntent;
  readonly instructions: AiStorySceneCompiledInstructions;
  readonly authority: PersistedSceneProviderCompilationAuthority;
  readonly compiledAt: string;
  readonly resolution?: "480p" | "720p" | "1080p";
  readonly referenceAssets?: readonly AiStoryReferenceAssetAuthority[];
  readonly sceneInputPreparation?: SceneInputPreparationAuthority | null;
  readonly preparedSceneFrame?: PreparedSceneFrameAuthority | null;
}): AiStoryCompiledProviderRequest {
  if (input.providerId !== "seedance") {
    throw new AiStoryProviderRuntimeError(
      "COMPILED_REQUEST_INVALID",
      "Canonical immutable Provider compilation is unavailable for the selected Provider"
    );
  }
  return compileImmutableSeedanceRequestFromSceneCompilation({
    intent: input.intent,
    instructions: input.instructions,
    authority: input.authority,
    adapterVersion: input.adapterVersion,
    compiledAt: input.compiledAt,
    ...(input.referenceAssets ? { referenceAssets: input.referenceAssets } : {}),
    ...(input.resolution ? { resolution: input.resolution } : {}),
    ...(input.sceneInputPreparation
      ? { sceneInputPreparation: input.sceneInputPreparation }
      : {}),
    ...(input.preparedSceneFrame
      ? { preparedSceneFrame: input.preparedSceneFrame }
      : {}),
  });
}
