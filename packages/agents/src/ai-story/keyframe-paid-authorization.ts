import {
  AI_STORY_KEYFRAME_PAID_AUTHORIZATION_CONTRACT_VERSION,
  AI_STORY_KEYFRAME_PAID_AUTHORIZATION_REASON,
  type AiStoryKeyframePaidAuthorizationFact,
} from "@ceo-agent/shared";
import { isKeyframePaidAuthorizationIntegrityValid, keyframePaidAuthorizationIntegrityHash } from "@ceo-agent/shared/server";
import {
  deterministicPersistenceUuid,
  type AiStoryKeyframePaidAuthorizationRepository,
} from "@ceo-agent/db";
import {
  CREATIVE_IMAGE_EXECUTION_CONTRACT_VERSION,
  type CreativeImageExecutionAuthorization,
} from "../creative-image/contracts";
import { isSceneInputPreparationIntegrityValid, type SceneInputPreparationAuthority } from "./scene-input-preparation";
import { isSceneKeyframeBriefIntegrityValid, type SceneKeyframeBrief, type SceneKeyframeScope } from "./scene-keyframe-preparation";

export type CurrentKeyframeAuthoritySnapshot = Readonly<{
  preparation: SceneInputPreparationAuthority;
  brief: SceneKeyframeBrief;
}>;

export interface CurrentKeyframeAuthoritySource {
  loadCurrent(scope: SceneKeyframeScope): Promise<CurrentKeyframeAuthoritySnapshot | null>;
}

export type AuthorizeSceneKeyframePaidGenerationCommand = Readonly<{
  authorizationRequestId: string;
  actorUserId: string;
  orgId: string;
  scope: SceneKeyframeScope;
  providerId: string;
  modelId: string;
}>;

export class KeyframePaidAuthorizationError extends Error {
  constructor(readonly code: "AUTHORIZATION_REQUIRED" | "CURRENT_KEYFRAME_AUTHORITY_INVALID" | "AUTHORIZATION_SCOPE_MISMATCH" | "AUTHORIZATION_PROVIDER_MISMATCH") {
    super(code);
    this.name = "KeyframePaidAuthorizationError";
  }
}

function assertCurrent(snapshot: CurrentKeyframeAuthoritySnapshot | null, scope: SceneKeyframeScope) {
  if (!snapshot || !isSceneInputPreparationIntegrityValid(snapshot.preparation) || !isSceneKeyframeBriefIntegrityValid(snapshot.brief)) {
    throw new KeyframePaidAuthorizationError("CURRENT_KEYFRAME_AUTHORITY_INVALID");
  }
  const actual = snapshot.brief.SCENE_IDENTITY;
  if (actual.tenantId !== scope.tenantId || actual.workspaceId !== scope.workspaceId || actual.storyId !== scope.storyId
    || actual.sceneId !== scope.sceneId || actual.sceneVersionId !== scope.sceneVersionId
    || snapshot.preparation.sceneId !== scope.sceneId || snapshot.preparation.sceneVersionId !== scope.sceneVersionId
    || snapshot.brief.preparationAuthorityId !== snapshot.preparation.preparationAuthorityId
    || snapshot.brief.preparationFingerprint !== snapshot.preparation.fingerprint) {
    throw new KeyframePaidAuthorizationError("AUTHORIZATION_SCOPE_MISMATCH");
  }
  return snapshot;
}

export class AiStoryKeyframePaidAuthorizationService {
  constructor(
    private readonly repository: AiStoryKeyframePaidAuthorizationRepository,
    private readonly currentAuthority: CurrentKeyframeAuthoritySource,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  async authorizeSceneKeyframePaidGeneration(command: AuthorizeSceneKeyframePaidGenerationCommand) {
    if (!command.actorUserId || !command.authorizationRequestId) throw new KeyframePaidAuthorizationError("AUTHORIZATION_REQUIRED");
    const current = assertCurrent(await this.currentAuthority.loadCurrent(command.scope), command.scope);
    const authorizationId = deterministicPersistenceUuid("ai-story-keyframe-paid-authorization", {
      authorizationRequestId: command.authorizationRequestId,
      orgId: command.orgId,
      scope: command.scope,
      preparationAuthorityId: current.preparation.preparationAuthorityId,
      preparationFingerprint: current.preparation.fingerprint,
      keyframeBriefFingerprint: current.brief.fingerprint,
      providerId: command.providerId,
      modelId: command.modelId,
    });
    const existing = await this.repository.findById(authorizationId);
    if (existing) return this.verify(existing, command.scope, command.providerId, command.modelId, current);

    const core = {
      authorizationId,
      contractVersion: AI_STORY_KEYFRAME_PAID_AUTHORIZATION_CONTRACT_VERSION,
      orgId: command.orgId,
      workspaceId: command.scope.workspaceId,
      storyId: command.scope.storyId,
      sceneId: command.scope.sceneId,
      sceneVersionId: command.scope.sceneVersionId,
      preparationAuthorityId: current.preparation.preparationAuthorityId,
      preparationFingerprint: current.preparation.fingerprint,
      keyframeBriefFingerprint: current.brief.fingerprint,
      authorizedProviderId: command.providerId,
      authorizedModelId: command.modelId,
      maximumImageProviderCalls: 1 as const,
      authorizedBy: command.actorUserId,
      authorizedAt: this.now(),
      authorizationReason: AI_STORY_KEYFRAME_PAID_AUTHORIZATION_REASON,
    };
    return this.repository.persist({ ...core, deterministicIntegrityHash: keyframePaidAuthorizationIntegrityHash(core) });
  }

  async loadVerified(authorizationId: string, scope: SceneKeyframeScope, providerId: string, modelId: string) {
    const fact = await this.repository.findById(authorizationId);
    if (!fact) throw new KeyframePaidAuthorizationError("AUTHORIZATION_REQUIRED");
    const current = assertCurrent(await this.currentAuthority.loadCurrent(scope), scope);
    return this.verify(fact, scope, providerId, modelId, current);
  }

  private verify(fact: AiStoryKeyframePaidAuthorizationFact, scope: SceneKeyframeScope, providerId: string, modelId: string, current: CurrentKeyframeAuthoritySnapshot) {
    if (!isKeyframePaidAuthorizationIntegrityValid(fact) || fact.maximumImageProviderCalls !== 1) throw new KeyframePaidAuthorizationError("AUTHORIZATION_REQUIRED");
    if (fact.orgId !== scope.tenantId || fact.workspaceId !== scope.workspaceId || fact.storyId !== scope.storyId
      || fact.sceneId !== scope.sceneId || fact.sceneVersionId !== scope.sceneVersionId
      || fact.preparationAuthorityId !== current.preparation.preparationAuthorityId
      || fact.preparationFingerprint !== current.preparation.fingerprint
      || fact.keyframeBriefFingerprint !== current.brief.fingerprint) throw new KeyframePaidAuthorizationError("AUTHORIZATION_SCOPE_MISMATCH");
    if (fact.authorizedProviderId !== providerId || fact.authorizedModelId !== modelId) throw new KeyframePaidAuthorizationError("AUTHORIZATION_PROVIDER_MISMATCH");
    return fact;
  }
}

export function mapKeyframePaidAuthorizationToCreativeImage(input: {
  fact: AiStoryKeyframePaidAuthorizationFact;
  executionIdentity: string;
  adapter: Readonly<{ providerId: string; modelId: string }>;
}): CreativeImageExecutionAuthorization {
  if (!isKeyframePaidAuthorizationIntegrityValid(input.fact)) throw new KeyframePaidAuthorizationError("AUTHORIZATION_REQUIRED");
  if (input.fact.authorizedProviderId !== input.adapter.providerId || input.fact.authorizedModelId !== input.adapter.modelId) {
    throw new KeyframePaidAuthorizationError("AUTHORIZATION_PROVIDER_MISMATCH");
  }
  return {
    contractVersion: CREATIVE_IMAGE_EXECUTION_CONTRACT_VERSION,
    authorizationId: input.fact.authorizationId,
    authorizedBy: input.fact.authorizedBy,
    authorizedAt: input.fact.authorizedAt,
    executionIdentity: input.executionIdentity,
    idempotencyKey: input.executionIdentity,
    providerId: input.fact.authorizedProviderId,
    modelId: input.fact.authorizedModelId,
    maximumProviderCalls: 1,
    scope: { tenantId: input.fact.orgId, workspaceId: input.fact.workspaceId, correlationId: input.fact.storyId },
  };
}
