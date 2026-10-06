import {
  deterministicUuidFromFingerprint,
  sha256CanonicalIntegrityHash,
} from "./canonical-integrity";
import {
  AiStoryCharacterVoiceDnaSchema,
  voiceDnaSemanticBody,
  type AiStoryCharacterVoiceDna,
  type VoiceDnaBuildInput,
} from "./ai-story-character-voice-dna";

const VOICE_DNA_ID_KIND = "ai-story-character-voice-dna";

/** Immutable Voice DNA. A changed semantic input is a new authority. */
export function buildAiStoryCharacterVoiceDna(
  input: VoiceDnaBuildInput
): AiStoryCharacterVoiceDna {
  const semantic = voiceDnaSemanticBody(input);
  const voiceDnaFingerprint = sha256CanonicalIntegrityHash(semantic);
  const voiceDnaId = deterministicUuidFromFingerprint(
    VOICE_DNA_ID_KIND,
    voiceDnaFingerprint
  );
  return AiStoryCharacterVoiceDnaSchema.parse({
    ...semantic,
    voiceDnaId,
    voiceDnaFingerprint,
  });
}
