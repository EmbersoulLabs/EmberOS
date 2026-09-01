import type {
  AiStoryCompiledProviderRequest,
  AiStorySceneCompiledInstructions,
  AiStorySceneExecutionIntent,
} from "@ceo-agent/shared";
import {
  AiStoryProviderRuntimeError,
  compileImmutableSeedanceRequestFromSceneCompilation,
  type PersistedSceneProviderCompilationAuthority,
} from "./provider-runtime-dispatch-integration";

export function compileImmutableSceneProviderRequest(input: {
  readonly providerId: string;
  readonly adapterVersion: string;
  readonly intent: AiStorySceneExecutionIntent;
  readonly instructions: AiStorySceneCompiledInstructions;
  readonly authority: PersistedSceneProviderCompilationAuthority;
  readonly compiledAt: string;
  readonly resolution?: "480p" | "720p" | "1080p";
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
    ...(input.resolution ? { resolution: input.resolution } : {}),
  });
}
