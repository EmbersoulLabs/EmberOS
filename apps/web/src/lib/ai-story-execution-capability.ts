import { LocalGpuCloudAdapter, loadLocalGpuConfigFromEnv } from "@ceo-agent/agents";
import type { PlatformAdminAssignment, ScenePlanItem } from "@ceo-agent/shared";
import {
  AI_STORY_EXECUTION_CAPABILITY_AUTHORITY_VERSION,
  type AiStoryExecutionCapabilityAuthority,
  type AiStorySceneGenerationAuthority,
} from "@ceo-agent/shared";
import {
  LOCAL_GPU_T2V_WORKFLOW,
  LOCAL_GPU_WORKER_WORKFLOW,
  assertLocalGpuV2RuntimeCapabilities,
  readLocalGpuV3T2vCapability,
  sha256CanonicalIntegrityHash,
} from "@ceo-agent/shared/server";

const CAPABILITY_AUTHORITY_TTL_MS = 5 * 60_000;

export class AiStoryExecutionCapabilityError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "AiStoryExecutionCapabilityError";
  }
}

function workflowFor(authority: AiStorySceneGenerationAuthority): string {
  if (
    authority.strategy === "TEXT_TO_VIDEO" &&
    authority.referenceSource === "REFERENCE_FREE_T2V"
  ) return LOCAL_GPU_T2V_WORKFLOW;
  return LOCAL_GPU_WORKER_WORKFLOW;
}

function assertSceneCapability(
  scene: ScenePlanItem,
  capabilities: unknown,
): { sceneId: string; strategy: AiStorySceneGenerationAuthority; workflow: string; status: "SUPPORTED" } {
  const authority = scene.generationAuthority;
  if (!authority) {
    throw new AiStoryExecutionCapabilityError(
      "PLANNING_GENERATION_AUTHORITY_MISSING",
      `Scene ${scene.id} has no frozen generation strategy`,
    );
  }
  const workflow = workflowFor(authority);
  try {
    if (workflow === LOCAL_GPU_T2V_WORKFLOW) {
      const t2v = readLocalGpuV3T2vCapability(capabilities);
      if (!t2v.e2eCertified) {
        throw new AiStoryExecutionCapabilityError(
          "PLANNING_EXECUTION_CAPABILITY_NOT_CERTIFIED",
          `Scene ${scene.id} requires ${workflow}, but Desktop has not certified it for end-to-end execution`,
        );
      }
    } else {
      assertLocalGpuV2RuntimeCapabilities(capabilities as never);
    }
  } catch (error) {
    if (error instanceof AiStoryExecutionCapabilityError) throw error;
    throw new AiStoryExecutionCapabilityError(
      "PLANNING_EXECUTION_CAPABILITY_UNSUPPORTED",
      `Scene ${scene.id} requires ${workflow}, which is unavailable in the selected LOCAL_GPU environment`,
    );
  }
  return { sceneId: scene.id, strategy: authority, workflow, status: "SUPPORTED" };
}

export function assertFreshExecutionCapabilityAuthority(
  authority: AiStoryExecutionCapabilityAuthority,
  scenePlan: readonly ScenePlanItem[],
  now = new Date(),
): void {
  if (Date.parse(authority.expiresAt) <= now.getTime()) {
    throw new AiStoryExecutionCapabilityError(
      "PLANNING_EXECUTION_CAPABILITY_STALE",
      "Execution capability evidence expired before Planning approval",
    );
  }
  if (authority.capabilityFingerprint !== sha256CanonicalIntegrityHash(authority.capabilities)) {
    throw new AiStoryExecutionCapabilityError(
      "PLANNING_EXECUTION_CAPABILITY_FINGERPRINT_MISMATCH",
      "Execution capability evidence failed its integrity check",
    );
  }
  const expected = scenePlan.map((scene) => assertSceneCapability(scene, authority.capabilities));
  if (sha256CanonicalIntegrityHash(expected) !== sha256CanonicalIntegrityHash(authority.scenes)) {
    throw new AiStoryExecutionCapabilityError(
      "PLANNING_EXECUTION_CAPABILITY_SCENE_MISMATCH",
      "Execution capability evidence does not bind the current Scene strategies",
    );
  }
}

export async function fetchLocalGpuPlanningCapabilityAuthority(input: {
  userId: string;
  workspaceId: string;
  assignment: PlatformAdminAssignment;
  scenePlan: readonly ScenePlanItem[];
  now?: Date;
}): Promise<AiStoryExecutionCapabilityAuthority> {
  const config = loadLocalGpuConfigFromEnv(process.env);
  if (!config.enabled || !config.environment) {
    throw new AiStoryExecutionCapabilityError(
      "PLANNING_EXECUTION_ENVIRONMENT_UNAVAILABLE",
      "The selected LOCAL_GPU environment is not enabled",
    );
  }
  const actor = {
    userId: input.userId,
    workspaceId: input.workspaceId,
    organizationPlan: null,
    platformAdminStatus: "ACTIVE_GRANT" as const,
  };
  const adapter = new LocalGpuCloudAdapter(config, async () => {
    throw new Error("LOCAL_GPU_GENERATION_NOT_PERMITTED_DURING_PLANNING");
  });
  const response = await fetch(`${config.baseUrl}/v1/capabilities`, {
    method: "GET",
    headers: { authorization: `Bearer ${adapter.capabilitiesToken({ actor, workspaceId: input.workspaceId })}` },
    cache: "no-store",
  });
  if (response.status !== 200) {
    throw new AiStoryExecutionCapabilityError(
      "PLANNING_EXECUTION_CAPABILITIES_UNAVAILABLE",
      "Desktop capability evidence could not be verified",
    );
  }
  const raw = await response.json();
  const capabilities = raw && typeof raw === "object" && "capabilities" in raw
    ? (raw as { capabilities: unknown }).capabilities
    : raw;
  const now = input.now ?? new Date();
  const authority: AiStoryExecutionCapabilityAuthority = {
    contractVersion: AI_STORY_EXECUTION_CAPABILITY_AUTHORITY_VERSION,
    executionEnvironment: "LOCAL_GPU",
    environment: config.environment,
    verifiedPlatformAdminAssignmentId: input.assignment.platformAdminAssignmentId,
    capabilityFingerprint: sha256CanonicalIntegrityHash(capabilities),
    fetchedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + CAPABILITY_AUTHORITY_TTL_MS).toISOString(),
    capabilities,
    scenes: input.scenePlan.map((scene) => assertSceneCapability(scene, capabilities)),
  };
  assertFreshExecutionCapabilityAuthority(authority, input.scenePlan, now);
  return authority;
}
