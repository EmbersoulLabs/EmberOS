import {
  projectVoiceDnaNativePerformanceInstruction,
  type AiStoryCharacterVoiceDna,
  type AiStoryLocalGenerationPackage,
} from "@ceo-agent/shared";
import {
  LocalGpuContractError,
  localGpuCreativeBindingDigest,
  type LocalGpuEnvironment,
  type LocalGpuUploadDestination,
} from "@ceo-agent/shared/server";
import {
  mapCanonicalPackageToLocalGpuContractV2,
  type LocalGpuResolvedAsset,
} from "./local-gpu-package-transport";

const R2V_WORKFLOW = "MINIMAX_H3_R2V" as const;

type CapabilityRecord = Record<string, unknown>;

function record(value: unknown): CapabilityRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as CapabilityRecord
    : null;
}

function fail(code: string): never {
  throw new LocalGpuContractError(code);
}

export type LocalGpuR2vDnaCapability = {
  workflow: typeof R2V_WORKFLOW;
  execution: "enabled";
  referenceToVideo: true;
  characterDna: true;
  sceneExecution: true;
  voiceDna: boolean;
  continuityFrame: boolean;
  audioPolicies: readonly string[];
  missingModels: [];
  e2eCertified: boolean;
};

/**
 * Reads only explicit Desktop claims. Older R2V capability responses remain
 * unsupported; the Laptop must not infer DNA support from a workflow id.
 */
export function readLocalGpuR2vDnaCapability(
  value: unknown,
  options: { voiceDnaRequired: boolean; continuityFrameRequired?: boolean; audioPolicy?: string },
): LocalGpuR2vDnaCapability {
  const root = record(value);
  const contracts = record(root?.contracts);
  const v3 = record(contracts?.v3);
  const workflows = record(v3?.workflows);
  const workflow = record(workflows?.[R2V_WORKFLOW]);
  const missingModels = Array.isArray(workflow?.missingModels)
    ? workflow.missingModels.filter((item) => typeof item === "string")
    : null;
  const audioPolicies = Array.isArray(workflow?.audioPolicies)
    ? workflow.audioPolicies.filter((item): item is string => typeof item === "string")
    : [];
  if (
    workflow?.execution !== "enabled"
    || workflow.referenceToVideo !== true
    || workflow.characterDna !== true
    || workflow.sceneExecution !== true
    || (options.voiceDnaRequired && workflow.voiceDna !== true)
    || (options.continuityFrameRequired && workflow.continuityFrame !== true)
    || (options.audioPolicy !== undefined && !audioPolicies.includes(options.audioPolicy))
    || !missingModels
    || missingModels.length > 0
  ) {
    fail("LOCAL_GPU_R2V_DNA_CAPABILITY_MISMATCH");
  }
  return {
    workflow: R2V_WORKFLOW,
    execution: "enabled",
    referenceToVideo: true,
    characterDna: true,
    sceneExecution: true,
    voiceDna: workflow.voiceDna === true,
    continuityFrame: workflow.continuityFrame === true,
    audioPolicies,
    missingModels: [],
    e2eCertified: workflow.e2eCertified === true,
  };
}

export type LocalGpuR2vDnaHandoff = {
  contractVersion: 3;
  assetMode: "WITH_ASSET";
  environment: LocalGpuEnvironment;
  jobId: string;
  workspaceId: string;
  workflow: typeof R2V_WORKFLOW;
  scene: {
    sceneExecutionId: string;
    prompt: string;
    durationSec: number;
    aspectRatio: string;
  };
  audioPolicy: "NATIVE" | "PRESERVE" | "NO_DIALOGUE_WITH_AMBIENT_AUDIO" | "REMOVE_AUDIO" | "SILENT_OUTPUT";
  characterDna: {
    characterId: string;
    characterVersionId: string;
    fingerprint: string;
  };
  voiceDna: null | {
    voiceDnaId: string;
    fingerprint: string;
    characterVersionId: string;
    consistencyMode: AiStoryCharacterVoiceDna["consistencyMode"];
    semanticInstruction: string;
    exactAcousticVoiceContinuity: "NOT_CLAIMED";
  };
  references: ReturnType<typeof mapCanonicalPackageToLocalGpuContractV2>["body"]["references"];
  firstFrame: ReturnType<typeof mapCanonicalPackageToLocalGpuContractV2>["body"]["firstFrame"];
  upload: LocalGpuUploadDestination;
};

/**
 * Produces the Laptop-side, integrity-bound Character DNA + optional Voice DNA
 * + Scene handoff for R2V. This function never dispatches. The existing worker
 * may submit it only after Desktop advertises every required V3 capability.
 */
export function prepareLocalGpuR2vDnaHandoff(input: {
  package: AiStoryLocalGenerationPackage;
  assets: readonly LocalGpuResolvedAsset[];
  environment: LocalGpuEnvironment;
  jobId: string;
  upload: LocalGpuUploadDestination;
  capabilities: unknown;
  voiceDna?: AiStoryCharacterVoiceDna | null;
}): {
  dispatch: false;
  submit: false;
  e2eCertified: boolean;
  handoff: LocalGpuR2vDnaHandoff;
  authorityBinding: string;
  uploadBinding: string;
} {
  const pkg = input.package;
  if (pkg.recommendedWorkflow !== R2V_WORKFLOW) fail("LOCAL_GPU_WORKFLOW_UNSUPPORTED");
  if (!pkg.characterAuthority) fail("LOCAL_GPU_CHARACTER_DNA_REQUIRED");
  if (pkg.dialogue.length > 0) fail("LOCAL_GPU_DISPATCH_DISABLED");

  const voiceDna = input.voiceDna ?? null;
  if (voiceDna) {
    if (voiceDna.status !== "APPROVED" && voiceDna.status !== "FROZEN") {
      fail("LOCAL_GPU_VOICE_DNA_UNAPPROVED");
    }
    if (
      voiceDna.workspaceId !== pkg.workspaceId
      || voiceDna.reusableCharacterId !== pkg.characterAuthority.characterId
      || voiceDna.reusableCharacterVersionId !== pkg.characterAuthority.characterVersionId
    ) {
      fail("LOCAL_GPU_VOICE_DNA_AUTHORITY_MISMATCH");
    }
    if (voiceDna.consistencyMode === "REFERENCE_AUDIO_IDENTITY") {
      fail("LOCAL_GPU_VOICE_DNA_REFERENCE_AUDIO_UNSUPPORTED");
    }
  }

  // Reuse the existing asset, content-hash, Character DNA, Scene, audio-policy,
  // and upload validation. Voice DNA is added only to the new V3 handoff.
  const validated = mapCanonicalPackageToLocalGpuContractV2({
    package: pkg,
    assets: input.assets,
    environment: input.environment,
    jobId: input.jobId,
    upload: input.upload,
  });
  const capability = readLocalGpuR2vDnaCapability(input.capabilities, {
    voiceDnaRequired: Boolean(voiceDna),
    continuityFrameRequired: validated.body.firstFrame !== null,
    audioPolicy: validated.body.audioPolicy,
  });
  const handoff: LocalGpuR2vDnaHandoff = {
    contractVersion: 3,
    assetMode: "WITH_ASSET",
    environment: input.environment,
    jobId: input.jobId,
    workspaceId: pkg.workspaceId,
    workflow: R2V_WORKFLOW,
    scene: {
      sceneExecutionId: pkg.sceneExecutionId,
      prompt: validated.body.prompt,
      durationSec: validated.body.durationSec,
      aspectRatio: pkg.aspectRatio,
    },
    audioPolicy: validated.body.audioPolicy,
    characterDna: {
      characterId: pkg.characterAuthority.characterId,
      characterVersionId: pkg.characterAuthority.characterVersionId,
      fingerprint: pkg.characterAuthority.dnaFingerprint,
    },
    voiceDna: voiceDna
      ? {
          voiceDnaId: voiceDna.voiceDnaId,
          fingerprint: voiceDna.voiceDnaFingerprint,
          characterVersionId: voiceDna.reusableCharacterVersionId,
          consistencyMode: voiceDna.consistencyMode,
          semanticInstruction: projectVoiceDnaNativePerformanceInstruction(voiceDna),
          exactAcousticVoiceContinuity: "NOT_CLAIMED",
        }
      : null,
    references: validated.body.references,
    firstFrame: validated.body.firstFrame,
    upload: validated.body.upload,
  };
  return {
    dispatch: false,
    submit: false,
    e2eCertified: capability.e2eCertified,
    handoff,
    authorityBinding: localGpuCreativeBindingDigest(handoff as unknown as Record<string, unknown>),
    uploadBinding: validated.uploadBinding,
  };
}
