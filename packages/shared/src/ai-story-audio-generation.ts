/**
 * Audio generation is separate from scripted dialogue and from silence.
 * Absence of dialogue does not require a silent file.
 */
export const AI_STORY_LOCAL_SPEECH_DETECTION_AVAILABLE = false as const;

export type AiStoryAudioGenerationSemantics = {
  nativeAudioGeneration: boolean;
  scriptedDialogueRequired: boolean;
  silentOutputRequired: boolean;
};

export function resolveAiStoryAudioGenerationSemantics(input: {
  visibleDialogueCount: number;
  explicitSilenceRequired: boolean;
}): AiStoryAudioGenerationSemantics {
  const silentOutputRequired = input.explicitSilenceRequired === true;
  return {
    nativeAudioGeneration: !silentOutputRequired,
    scriptedDialogueRequired: input.visibleDialogueCount > 0,
    silentOutputRequired,
  };
}
