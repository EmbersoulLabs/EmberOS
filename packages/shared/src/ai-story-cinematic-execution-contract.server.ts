import { sha256CanonicalIntegrityHash } from "./canonical-integrity";
import {
  AI_STORY_CINEMATIC_EXECUTION_CONTRACT_VERSION,
  compileCinematicExecutionProjection,
} from "./ai-story-cinematic-execution-contract";

export function fingerprintCinematicExecutionProjection(
  projection: ReturnType<typeof compileCinematicExecutionProjection>,
): string {
  return sha256CanonicalIntegrityHash({
    kind: AI_STORY_CINEMATIC_EXECUTION_CONTRACT_VERSION,
    creativeAuthority: false,
    compiledProjection: true,
    projection,
  });
}
