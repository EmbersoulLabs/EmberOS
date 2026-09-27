import {
  AiStoryScriptAuthorityService,
  AiStoryScriptSemanticProposalAuthorityService,
  resolveCurrentFrozenOutlineForStoryVersion,
  type AiStoryScriptScope,
  getDb,
} from "@ceo-agent/db";
import { generateAiStoryScriptSemanticProposalV1 } from "@ceo-agent/agents";
import {
  AI_STORY_COMMERCIAL_STORY_PROFILE_POLICY_FINGERPRINT,
  AI_STORY_PRODUCT_STORY_PROFILE_POLICY_FINGERPRINT,
  AiStoryScriptSemanticProposalV1Schema,
  resolveOutlineBoundProductAuthorityIds,
  validateAiStoryScript,
  type AiStoryOutlineVersion,
  type AiStoryScriptSemanticProposalV1,
  type AiStoryScriptVersion,
  type AiStoryStructuredDraft,
  type CreativeContext,
  type DirectorThinking,
  type PlanningCharacterAuthorityProjection,
  type PlanningUsage,
  type ScenePlanItem,
  type StoryBeat,
} from "@ceo-agent/shared";
import {
  buildAiStoryScriptVersion,
  computeAiStoryScriptSemanticInputFingerprint,
  computeAiStoryScriptSourceHash,
  promoteAiStoryScriptSemanticProposalV1,
  validateAiStoryCommercialStoryProfile,
} from "@ceo-agent/shared/server";

type Db = ReturnType<typeof getDb>;

export class AiStoryCanonicalScriptProducerError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "AiStoryCanonicalScriptProducerError";
  }
}

export type EnsureCurrentFrozenCanonicalScriptInput = {
  db: Db;
  orgId: string;
  workspaceId: string;
  campaignId: string;
  storyId: string;
  storyVersionId: string;
  actorUserId: string;
  story: AiStoryStructuredDraft;
  storyBeats: StoryBeat[];
  scenePlan: ScenePlanItem[];
  creativeContext: CreativeContext;
  directorThinking: DirectorThinking;
  characterAuthorities: PlanningCharacterAuthorityProjection[];
};

type SemanticWriter = typeof generateAiStoryScriptSemanticProposalV1;
type SemanticPromoter = typeof promoteAiStoryScriptSemanticProposalV1;

export type CanonicalScriptProducerDependencies = {
  resolveCurrentOutline: typeof resolveCurrentFrozenOutlineForStoryVersion;
  history: (db: Db, scope: AiStoryScriptScope) => Promise<AiStoryScriptVersion[]>;
  generateSemanticProposal: SemanticWriter;
  promoteSemanticProposal: SemanticPromoter;
  propose: (db: Db, scope: AiStoryScriptScope, script: AiStoryScriptVersion) => Promise<AiStoryScriptVersion>;
  validate: (db: Db, scope: AiStoryScriptScope, scriptVersionId: string) => Promise<AiStoryScriptVersion>;
  approve: (db: Db, scope: AiStoryScriptScope, scriptVersionId: string) => Promise<AiStoryScriptVersion>;
  freeze: (db: Db, scope: AiStoryScriptScope, scriptVersionId: string) => Promise<AiStoryScriptVersion>;
  resolveAuthorizedProposal?: (
    db: Db,
    scope: AiStoryScriptScope,
  ) => Promise<{
    proposal: AiStoryScriptSemanticProposalV1;
    semanticInputFingerprint: string;
    profileId?: "PRODUCT_STORY" | "COMMERCIAL_STORY";
  } | null>;
  persistAuthorizedProposal?: (
    db: Db,
    scope: AiStoryScriptScope,
    proposal: AiStoryScriptSemanticProposalV1,
    semanticInputFingerprint: string,
    authorizedAt: string,
    profileId: "PRODUCT_STORY" | "COMMERCIAL_STORY",
  ) => Promise<void>;
  now: () => string;
};

const defaultDependencies: CanonicalScriptProducerDependencies = {
  resolveCurrentOutline: resolveCurrentFrozenOutlineForStoryVersion,
  history: (db, scope) => new AiStoryScriptAuthorityService(db).history(scope),
  generateSemanticProposal: generateAiStoryScriptSemanticProposalV1,
  promoteSemanticProposal: promoteAiStoryScriptSemanticProposalV1,
  propose: (db, scope, script) => new AiStoryScriptAuthorityService(db).propose(scope, script),
  validate: (db, scope, id) => new AiStoryScriptAuthorityService(db).validate(scope, id),
  approve: (db, scope, id) => new AiStoryScriptAuthorityService(db).approve(scope, id),
  freeze: (db, scope, id) => new AiStoryScriptAuthorityService(db).freeze(scope, id),
  resolveAuthorizedProposal: async (db, scope) => {
    const row = await new AiStoryScriptSemanticProposalAuthorityService(db).resolveExact(scope);
    return row ? { proposal: row.proposal, semanticInputFingerprint: row.semanticInputFingerprint, profileId: row.profileId } : null;
  },
  persistAuthorizedProposal: async (db, scope, proposal, semanticInputFingerprint, authorizedAt, profileId) => {
    await new AiStoryScriptSemanticProposalAuthorityService(db).authorize({
      ...scope,
      profileId,
      proposal,
      semanticInputFingerprint,
      originatingRunId: semanticInputFingerprint,
      groundingLineage: {
        semanticInputFingerprint,
        storyId: scope.storyId,
        storyVersionId: scope.storyVersionId,
      },
      authorizedAt,
    });
  },
  now: () => new Date().toISOString(),
};

const zeroUsage = (): PlanningUsage => ({ input: 0, output: 0, costUsd: 0 });
const incomplete = (status: AiStoryScriptVersion["status"]) => status === "DRAFT" || status === "VALIDATED" || status === "APPROVED";

async function advanceToFrozen(
  input: EnsureCurrentFrozenCanonicalScriptInput,
  scope: AiStoryScriptScope,
  initial: AiStoryScriptVersion,
  deps: CanonicalScriptProducerDependencies,
) {
  let current = initial;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (current.status === "FROZEN") return current;
    if (current.status === "SUPERSEDED") throw new AiStoryCanonicalScriptProducerError("CANONICAL_SCRIPT_LINEAGE_INVALID", "Desired Script authority is unexpectedly SUPERSEDED");
    try {
      current = current.status === "DRAFT"
        ? await deps.validate(input.db, scope, current.scriptVersionId)
        : current.status === "VALIDATED"
          ? await deps.approve(input.db, scope, current.scriptVersionId)
          : await deps.freeze(input.db, scope, current.scriptVersionId);
    } catch (error) {
      const refreshed = (await deps.history(input.db, scope)).find((item) => item.scriptVersionId === current.scriptVersionId);
      if (!refreshed || refreshed.status === current.status) throw error;
      current = refreshed;
    }
  }
  throw new AiStoryCanonicalScriptProducerError("CANONICAL_SCRIPT_LIFECYCLE_DID_NOT_CONVERGE", "Script lifecycle did not converge to FROZEN");
}

type AuthorizedSemanticProposal = {
  proposal: AiStoryScriptSemanticProposalV1;
  semanticInputFingerprint: string;
  profileId?: "PRODUCT_STORY" | "COMMERCIAL_STORY";
};

function requireCommercialSemanticAuthority(
  persisted: AuthorizedSemanticProposal | null,
  semanticInputFingerprint: string,
): AiStoryScriptSemanticProposalV1 {
  if (!persisted) {
    throw new AiStoryCanonicalScriptProducerError(
      "COMMERCIAL_STORY_SCRIPT_SEMANTIC_AUTHORITY_REQUIRED",
      "The canonical Script cannot be created because upstream authorized Script semantic authority is missing.",
    );
  }
  if (persisted.profileId !== "COMMERCIAL_STORY") {
    throw new AiStoryCanonicalScriptProducerError(
      "COMMERCIAL_STORY_SCRIPT_SEMANTIC_AUTHORITY_PROFILE_INVALID",
      "Canonical COMMERCIAL_STORY Script requires an authorized COMMERCIAL_STORY semantic proposal.",
    );
  }
  const parsed = AiStoryScriptSemanticProposalV1Schema.safeParse(persisted.proposal);
  if (!parsed.success) {
    throw new AiStoryCanonicalScriptProducerError(
      "COMMERCIAL_STORY_SCRIPT_SEMANTIC_AUTHORITY_INTEGRITY_INVALID",
      "Persisted COMMERCIAL_STORY semantic proposal failed integrity validation.",
    );
  }
  if (persisted.semanticInputFingerprint !== semanticInputFingerprint) {
    throw new AiStoryCanonicalScriptProducerError(
      "CANONICAL_SCRIPT_SEMANTIC_AUTHORITY_STALE",
      "Authorized semantic Script proposal does not match this Story Version input",
    );
  }
  return parsed.data;
}

/**
 * In-memory candidate gate. AUTHORIZED persistence happens only after this returns.
 * Promotion and Script validation failures leave the Story Version's proposal slot free.
 */
function assertCommercialScriptCandidatePreAuthorization(
  input: EnsureCurrentFrozenCanonicalScriptInput,
  outline: AiStoryOutlineVersion,
  proposal: AiStoryScriptSemanticProposalV1,
  semanticInputFingerprint: string,
  productAuthorityIds: readonly string[],
  deps: CanonicalScriptProducerDependencies,
) {
  if (
    outline.orgId !== input.orgId
    || outline.workspaceId !== input.workspaceId
    || outline.storyId !== input.storyId
    || outline.storyVersionId !== input.storyVersionId
    || outline.status !== "FROZEN"
  ) {
    throw new AiStoryCanonicalScriptProducerError(
      "CANONICAL_SCRIPT_OUTLINE_AUTHORITY_INVALID",
      "Script candidate authorization requires the exact frozen Outline for this Story Version",
    );
  }
  const material = deps.promoteSemanticProposal({
    storyId: input.storyId,
    storyVersionId: input.storyVersionId,
    frozenOutline: outline,
    storyBeatProposals: input.storyBeats,
    scenePlan: input.scenePlan,
    characterAuthorities: input.characterAuthorities,
    semanticProposal: proposal,
  });
  const script = buildAiStoryScriptVersion({
    storyId: input.storyId,
    storyVersionId: input.storyVersionId,
    outlineVersionId: outline.outlineVersionId,
    orgId: outline.orgId,
    workspaceId: outline.workspaceId,
    version: 1,
    profileId: outline.profile.profileId,
    profileVersion: outline.profile.profileVersion,
    outlineSourceHash: outline.sourceHash,
    semanticInputFingerprint,
    scenes: material.scenes,
    authorityReferences: material.authorityReferences,
    supersedesScriptVersionId: null,
    createdBy: input.actorUserId,
    createdAt: deps.now(),
  });
  const knownAuthorityReferences = new Set<string>([
    ...input.characterAuthorities.map((authority) => `CHARACTER:${authority.characterId}`),
    ...productAuthorityIds.map((productId) => `PRODUCT:${productId}`),
  ]);
  const blocking = [
    ...validateAiStoryScript(script, outline, { knownAuthorityReferences }).filter((issue) => issue.severity === "BLOCK"),
    ...validateAiStoryCommercialStoryProfile(outline, script).filter((issue) => issue.severity === "BLOCK"),
  ];
  if (blocking.length > 0) {
    throw new AiStoryCanonicalScriptProducerError(
      "CANONICAL_SCRIPT_PRE_AUTHORIZATION_FAILED",
      blocking.map((issue) => `${issue.gate}: ${issue.message}`).join("; "),
    );
  }
}

/**
 * Upstream COMMERCIAL_STORY authoring. Canonical Script production does not call this.
 * A candidate is authorized only after deterministic promotion and Script validation pass.
 * One writer call per invocation; a failed candidate does not occupy the immutable slot.
 */
export async function produceAuthorizedCommercialStoryScriptProposal(
  input: EnsureCurrentFrozenCanonicalScriptInput,
  deps: CanonicalScriptProducerDependencies = defaultDependencies,
): Promise<{ proposal: AiStoryScriptSemanticProposalV1; semanticInputFingerprint: string; usage: PlanningUsage; semanticWriterCalled: boolean }> {
  const outline = await deps.resolveCurrentOutline(input.db, {
    orgId: input.orgId,
    workspaceId: input.workspaceId,
    campaignId: input.campaignId,
    storyId: input.storyId,
    storyVersionId: input.storyVersionId,
  });
  if (!outline) throw new AiStoryCanonicalScriptProducerError("CURRENT_FROZEN_OUTLINE_REQUIRED", "Script semantic authority requires the exact current frozen Outline");
  const commercial = outline.profile.profileId === "COMMERCIAL_STORY"
    && outline.profile.profileVersion === 1
    && outline.profile.policyFingerprint === AI_STORY_COMMERCIAL_STORY_PROFILE_POLICY_FINGERPRINT;
  if (!commercial) {
    throw new AiStoryCanonicalScriptProducerError("CANONICAL_SCRIPT_PROFILE_UNSUPPORTED", "Commercial Script proposal authoring requires exact COMMERCIAL_STORY v1 authority");
  }
  const productAuthorityIds = resolveOutlineBoundProductAuthorityIds(outline);
  const semanticInputFingerprint = computeAiStoryScriptSemanticInputFingerprint({
    storyId: input.storyId,
    storyVersionId: input.storyVersionId,
    outlineVersionId: outline.outlineVersionId,
    outlineSourceHash: outline.sourceHash,
    story: input.story,
    storyBeats: input.storyBeats,
    scenePlan: input.scenePlan,
    creativeContext: input.creativeContext,
    directorThinking: input.directorThinking,
    characterAuthorities: input.characterAuthorities,
    productAuthorityIds,
  });
  const scope: AiStoryScriptScope = {
    orgId: input.orgId,
    workspaceId: input.workspaceId,
    campaignId: input.campaignId,
    storyId: input.storyId,
    storyVersionId: input.storyVersionId,
    actorUserId: input.actorUserId,
    requireCurrentFrozenStoryVersion: true,
  };
  const persisted = await (deps.resolveAuthorizedProposal ?? (async () => null))(input.db, scope);
  if (persisted) {
    return {
      proposal: requireCommercialSemanticAuthority(persisted, semanticInputFingerprint),
      semanticInputFingerprint,
      usage: zeroUsage(),
      semanticWriterCalled: false,
    };
  }
  const generated = await deps.generateSemanticProposal({
    frozenOutline: outline,
    story: input.story,
    storyBeats: input.storyBeats,
    scenePlan: input.scenePlan,
    creativeContext: input.creativeContext,
    directorThinking: input.directorThinking,
    characterAuthorities: input.characterAuthorities,
    productAuthorityIds,
  });
  const proposal = AiStoryScriptSemanticProposalV1Schema.parse(generated.semanticProposal);
  assertCommercialScriptCandidatePreAuthorization(
    input,
    outline,
    proposal,
    semanticInputFingerprint,
    productAuthorityIds,
    deps,
  );
  await (deps.persistAuthorizedProposal ?? (async () => undefined))(
    input.db,
    scope,
    proposal,
    semanticInputFingerprint,
    deps.now(),
    "COMMERCIAL_STORY",
  );
  return { proposal, semanticInputFingerprint, usage: generated.usage, semanticWriterCalled: true };
}

/** Ensures one exact current FROZEN Script. COMMERCIAL_STORY only consumes an already authorized proposal. */
export async function ensureCurrentFrozenCanonicalScript(
  input: EnsureCurrentFrozenCanonicalScriptInput,
  deps: CanonicalScriptProducerDependencies = defaultDependencies,
): Promise<{ script: AiStoryScriptVersion; usage: PlanningUsage; semanticWriterCalled: boolean }> {
  const outline = await deps.resolveCurrentOutline(input.db, {
    orgId: input.orgId,
    workspaceId: input.workspaceId,
    campaignId: input.campaignId,
    storyId: input.storyId,
    storyVersionId: input.storyVersionId,
  });
  if (!outline) throw new AiStoryCanonicalScriptProducerError("CURRENT_FROZEN_OUTLINE_REQUIRED", "Canonical Script requires the exact current frozen Outline");
  const commercial = outline.profile.profileId === "COMMERCIAL_STORY"
    && outline.profile.profileVersion === 1
    && outline.profile.policyFingerprint === AI_STORY_COMMERCIAL_STORY_PROFILE_POLICY_FINGERPRINT;
  const productStory = outline.profile.profileId === "PRODUCT_STORY"
    && outline.profile.profileVersion === 1
    && outline.profile.policyFingerprint === AI_STORY_PRODUCT_STORY_PROFILE_POLICY_FINGERPRINT;
  if (!commercial && !productStory) {
    throw new AiStoryCanonicalScriptProducerError("CANONICAL_SCRIPT_PROFILE_UNSUPPORTED", "V1 Script producer requires exact PRODUCT_STORY or COMMERCIAL_STORY v1 authority");
  }
  const productAuthorityIds = resolveOutlineBoundProductAuthorityIds(outline);
  const outlineCharacters = outline.authorityReferences
    .filter((reference) => reference.authorityType === "CHARACTER")
    .map((reference) => ({
      characterId: reference.authorityId,
      characterVersionId: reference.authorityVersionId,
      characterFingerprint: reference.authorityFingerprint,
    }))
    .sort((left, right) => left.characterId.localeCompare(right.characterId));
  const currentCharacters = input.characterAuthorities
    .map((authority) => ({
      characterId: authority.characterId,
      characterVersionId: authority.characterVersionId,
      characterFingerprint: authority.characterFingerprint,
    }))
    .sort((left, right) => left.characterId.localeCompare(right.characterId));
  if (JSON.stringify(outlineCharacters) !== JSON.stringify(currentCharacters)) {
    throw new AiStoryCanonicalScriptProducerError("CANONICAL_SCRIPT_CHARACTER_AUTHORITY_STALE", "Current Character authority does not match the exact frozen Outline snapshot");
  }
  const semanticInputFingerprint = computeAiStoryScriptSemanticInputFingerprint({
    storyId: input.storyId,
    storyVersionId: input.storyVersionId,
    outlineVersionId: outline.outlineVersionId,
    outlineSourceHash: outline.sourceHash,
    story: input.story,
    storyBeats: input.storyBeats,
    scenePlan: input.scenePlan,
    creativeContext: input.creativeContext,
    directorThinking: input.directorThinking,
    characterAuthorities: input.characterAuthorities,
    productAuthorityIds,
  });
  const scope: AiStoryScriptScope = {
    orgId: input.orgId,
    workspaceId: input.workspaceId,
    campaignId: input.campaignId,
    storyId: input.storyId,
    storyVersionId: input.storyVersionId,
    actorUserId: input.actorUserId,
    requireCurrentFrozenStoryVersion: true,
  };
  const history = await deps.history(input.db, scope);
  const latest = history.at(-1);
  const persistedEarly = commercial
    ? await (deps.resolveAuthorizedProposal ?? (async () => null))(input.db, scope)
    : null;
  const commercialProposal = commercial ? requireCommercialSemanticAuthority(persistedEarly, semanticInputFingerprint) : null;
  if (latest?.status === "SUPERSEDED") {
    throw new AiStoryCanonicalScriptProducerError("CANONICAL_SCRIPT_LINEAGE_INVALID", "Latest durable Script cannot be SUPERSEDED without a successor");
  }
  const sameInput = latest &&
    latest.storyVersionId === input.storyVersionId &&
    latest.outlineVersionId === outline.outlineVersionId &&
    latest.outlineSourceHash === outline.sourceHash &&
    latest.semanticInputFingerprint === semanticInputFingerprint;
  if (sameInput) {
    if (
      computeAiStoryScriptSourceHash(latest) !== latest.sourceHash ||
      latest.profileId !== outline.profile.profileId || latest.profileVersion !== outline.profile.profileVersion
    ) {
      throw new AiStoryCanonicalScriptProducerError("CANONICAL_SCRIPT_EXISTING_AUTHORITY_INVALID", "Matching Script authority failed source or profile validation");
    }
    if (latest.status === "FROZEN" && (!latest.approvedBy || !latest.approvedAt || !latest.frozenAt)) {
      throw new AiStoryCanonicalScriptProducerError("CANONICAL_SCRIPT_EXISTING_AUTHORITY_INVALID", "FROZEN Script lacks approval or freeze evidence");
    }
    return {
      script: await advanceToFrozen(input, scope, latest, deps),
      usage: zeroUsage(),
      semanticWriterCalled: false,
    };
  }
  if (latest && incomplete(latest.status)) {
    throw new AiStoryCanonicalScriptProducerError("CANONICAL_SCRIPT_INCOMPLETE_LINEAGE_CONFLICT", "A different-input Script has an incomplete durable lifecycle");
  }

  const persisted = commercial
    ? persistedEarly
    : await (deps.resolveAuthorizedProposal ?? (async () => null))(input.db, scope);
  if (!commercial && persisted && persisted.semanticInputFingerprint !== semanticInputFingerprint) {
    throw new AiStoryCanonicalScriptProducerError("CANONICAL_SCRIPT_SEMANTIC_AUTHORITY_STALE", "Authorized semantic Script proposal does not match this Story Version input");
  }
  const generated = commercialProposal
    ? { semanticProposal: commercialProposal, usage: zeroUsage() }
    : persisted
    ? { semanticProposal: persisted.proposal, usage: zeroUsage() }
    : await deps.generateSemanticProposal({
      frozenOutline: outline,
      story: input.story,
      storyBeats: input.storyBeats,
      scenePlan: input.scenePlan,
      creativeContext: input.creativeContext,
      directorThinking: input.directorThinking,
      characterAuthorities: input.characterAuthorities,
      productAuthorityIds,
    });
  const material = deps.promoteSemanticProposal({
    storyId: input.storyId,
    storyVersionId: input.storyVersionId,
    frozenOutline: outline,
    storyBeatProposals: input.storyBeats,
    scenePlan: input.scenePlan,
    characterAuthorities: input.characterAuthorities,
    semanticProposal: generated.semanticProposal,
  });
  const script = buildAiStoryScriptVersion({
    storyId: input.storyId,
    storyVersionId: input.storyVersionId,
    outlineVersionId: outline.outlineVersionId,
    orgId: outline.orgId,
    workspaceId: outline.workspaceId,
    version: latest ? latest.version + 1 : 1,
    profileId: outline.profile.profileId,
    profileVersion: outline.profile.profileVersion,
    outlineSourceHash: outline.sourceHash,
    semanticInputFingerprint,
    scenes: material.scenes,
    authorityReferences: material.authorityReferences,
    supersedesScriptVersionId: latest?.status === "FROZEN" ? latest.scriptVersionId : null,
    createdBy: input.actorUserId,
    createdAt: deps.now(),
  });
  const proposed = await deps.propose(input.db, scope, script);
  const frozen = await advanceToFrozen(input, scope, proposed, deps);
  if (!persisted && !commercial) {
    await (deps.persistAuthorizedProposal ?? (async () => undefined))(
      input.db,
      scope,
      generated.semanticProposal,
      semanticInputFingerprint,
      frozen.frozenAt ?? deps.now(),
      "PRODUCT_STORY",
    );
  }
  return {
    script: frozen,
    usage: generated.usage,
    semanticWriterCalled: !commercial && !persisted,
  };
}
