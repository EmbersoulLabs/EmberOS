import { z } from "zod";
import {
  AiStoryAssetAnalysisSnapshotSchema,
  AiStoryAssetBindingRoleSchema,
} from "./ai-story-asset-aware-execution-planner";
import {
  AiStoryAssetMatchingResultSchema,
  type AiStoryAssetMatchingResult,
} from "./ai-story-asset-matching";
import { visualSemanticFactsFromSnapshot } from "./ai-story-asset-semantic-intelligence";

export const AI_STORY_SCENE_GROUNDING_CONTEXT_VERSION =
  "ai-story-scene-grounding-context.v1" as const;
export const AI_STORY_SCENE_GROUNDING_LINEAGE_VERSION =
  "ai-story-scene-grounding-lineage.v1" as const;

const Id = z.string().uuid();
const Text = z.string().trim().min(1).max(1000);

export const AiStorySceneGroundingBindingSchema = z.object({
  bindingId: Id,
  assetId: Id,
  role: AiStoryAssetBindingRoleSchema,
  analysisSnapshotId: Id,
  observedFacts: z.array(Text),
  namedItems: z.array(Text),
  productCandidates: z.array(z.object({
    name: Text,
    relationship: z.enum([
      "PRIMARY_PRODUCT",
      "ADDON_OR_COMPONENT",
      "CATALOG_CHOICE",
      "UNSPECIFIED_PRODUCT",
    ]),
    evidence: z.array(Text).min(1),
  }).strict()),
}).strict();

export const AiStoryScenePlanningGroundingContextSchema = z.object({
  contractVersion: z.literal(AI_STORY_SCENE_GROUNDING_CONTEXT_VERSION),
  orgId: Id,
  workspaceId: Id,
  storyId: Id,
  storyVersionId: Id,
  matchingResultId: Id,
  bindings: z.array(AiStorySceneGroundingBindingSchema),
}).strict();

export const AiStorySceneGroundingProposalSchema = z.object({
  sceneId: Text,
  narrativeIntent: Text,
  visualIntent: Text,
  evidence: z.array(z.object({
    bindingId: Id,
    groundedFacts: z.array(Text).min(1),
  }).strict()),
  visualClaims: z.array(z.object({
    subject: Text,
    detail: Text,
    evidenceLevel: z.enum(["EXISTENCE_ONLY", "OBSERVED_APPEARANCE"]),
  }).strict()),
}).strict();

export const AiStorySceneGroundingLineageSchema = z.object({
  contractVersion: z.literal(AI_STORY_SCENE_GROUNDING_LINEAGE_VERSION),
  storyId: Id,
  storyVersionId: Id,
  matchingResultId: Id,
  narrativeIntent: Text,
  visualIntent: Text,
  evidence: z.array(z.object({
    bindingId: Id,
    assetId: Id,
    role: AiStoryAssetBindingRoleSchema,
    semanticSnapshotId: Id,
    groundedFacts: z.array(Text).min(1),
  }).strict()),
  visualClaims: AiStorySceneGroundingProposalSchema.shape.visualClaims,
}).strict();

export type AiStoryScenePlanningGroundingContext = z.infer<
  typeof AiStoryScenePlanningGroundingContextSchema
>;
export type AiStorySceneGroundingProposal = z.infer<
  typeof AiStorySceneGroundingProposalSchema
>;
export type AiStorySceneGroundingLineage = z.infer<
  typeof AiStorySceneGroundingLineageSchema
>;

export class AiStorySceneGroundingError extends Error {
  constructor(
    readonly code:
      | "SCENE_GROUNDING_AUTHORITY_REQUIRED"
      | "SCENE_GROUNDING_SCOPE_MISMATCH"
      | "SCENE_GROUNDING_STALE_STORY_VERSION"
      | "SCENE_GROUNDING_BINDING_INVALID"
      | "SCENE_GROUNDING_SUBJECT_BINDING_REQUIRED"
      | "SCENE_GROUNDING_SUBJECT_BINDING_AMBIGUOUS"
      | "SCENE_GROUNDING_UNSUPPORTED_CLAIM",
    message: string,
  ) {
    super(message);
    this.name = "AiStorySceneGroundingError";
  }
}

export function assertScenePlanningGroundingScope(
  contextInput: AiStoryScenePlanningGroundingContext,
  expected: {
    orgId: string;
    workspaceId: string;
    storyId: string;
    storyVersionId: string;
  },
): void {
  const context = AiStoryScenePlanningGroundingContextSchema.parse(contextInput);
  if (
    context.orgId !== expected.orgId ||
    context.workspaceId !== expected.workspaceId ||
    context.storyId !== expected.storyId
  ) {
    throw new AiStorySceneGroundingError(
      "SCENE_GROUNDING_SCOPE_MISMATCH",
      "Scene grounding authority is outside the current Story scope",
    );
  }
  if (context.storyVersionId !== expected.storyVersionId) {
    throw new AiStorySceneGroundingError(
      "SCENE_GROUNDING_STALE_STORY_VERSION",
      "Scene grounding authority belongs to a stale Story Version",
    );
  }
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function namesObservedSubject(value: string, subject: string): boolean {
  const normalizedValue = normalized(value);
  const normalizedSubject = normalized(subject);
  return normalizedValue === normalizedSubject ||
    normalizedValue.startsWith(`${normalizedSubject} `) ||
    normalizedValue.endsWith(` ${normalizedSubject}`);
}

/**
 * Deterministic projection of accepted matching authority for Scene Planning.
 * It performs no inference and never reads raw Asset bytes.
 */
export function buildScenePlanningGroundingContext(input: {
  result: AiStoryAssetMatchingResult;
  snapshots: readonly z.infer<typeof AiStoryAssetAnalysisSnapshotSchema>[];
}): AiStoryScenePlanningGroundingContext {
  const result = AiStoryAssetMatchingResultSchema.parse(input.result);
  const snapshotById = new Map(
    input.snapshots.map((snapshot) => {
      const parsed = AiStoryAssetAnalysisSnapshotSchema.parse(snapshot);
      return [parsed.snapshotId, parsed] as const;
    }),
  );
  const bindings = result.bindings
    .filter((binding) => binding.status === "ACTIVE" && binding.role !== "UNUSED")
    .map((binding) => {
      const snapshot = snapshotById.get(binding.analysisSnapshotId);
      if (
        !snapshot ||
        snapshot.orgId !== result.orgId ||
        snapshot.workspaceId !== result.workspaceId ||
        snapshot.analyzedContentHash !== binding.assetContentHash
      ) {
        throw new AiStorySceneGroundingError(
          "SCENE_GROUNDING_BINDING_INVALID",
          `Accepted binding ${binding.bindingId} does not resolve its exact semantic Snapshot`,
        );
      }
      const facts = visualSemanticFactsFromSnapshot(snapshot);
      return {
        bindingId: binding.bindingId,
        assetId: binding.assetId,
        role: binding.role,
        analysisSnapshotId: binding.analysisSnapshotId,
        observedFacts: unique([
          ...facts.observed.visibleText,
          ...facts.observed.namedItems,
          ...facts.observed.objects,
          ...facts.observed.environmentCues,
          ...facts.observed.brandOrLogoCues,
        ]),
        namedItems: unique([
          ...facts.observed.visibleText,
          ...facts.observed.namedItems,
          ...facts.inferred.productCandidates.map((candidate) => candidate.name),
          ...(facts.inferred.categories.includes("MENU_OR_CATALOG") ? ["Menu"] : []),
        ]),
        productCandidates: facts.inferred.productCandidates.map((candidate) => ({
          name: candidate.name,
          relationship: candidate.relationship,
          evidence: candidate.evidence,
        })),
      };
    });
  return AiStoryScenePlanningGroundingContextSchema.parse({
    contractVersion: AI_STORY_SCENE_GROUNDING_CONTEXT_VERSION,
    orgId: result.orgId,
    workspaceId: result.workspaceId,
    storyId: result.storyId,
    storyVersionId: result.storyVersionId,
    matchingResultId: result.matchingResultId,
    bindings,
  });
}

/**
 * Converts untrusted Scene grounding selections into immutable lineage.
 * Every selected fact and visual claim must be supported by an accepted binding.
 */
export function bindSceneGroundingLineage(input: {
  context: AiStoryScenePlanningGroundingContext;
  sceneIds: readonly string[];
  proposals: readonly AiStorySceneGroundingProposal[];
}): ReadonlyMap<string, AiStorySceneGroundingLineage> {
  const context = AiStoryScenePlanningGroundingContextSchema.parse(input.context);
  const proposals = input.proposals.map((proposal) =>
    AiStorySceneGroundingProposalSchema.parse(proposal),
  );
  if (
    proposals.length !== input.sceneIds.length ||
    new Set(proposals.map((proposal) => proposal.sceneId)).size !== proposals.length ||
    proposals.some((proposal) => !input.sceneIds.includes(proposal.sceneId))
  ) {
    throw new AiStorySceneGroundingError(
      "SCENE_GROUNDING_AUTHORITY_REQUIRED",
      `Scene grounding must cover every planned Scene exactly once (scenes=${input.sceneIds.length} selections=${proposals.length})`,
    );
  }
  const bindingById = new Map(context.bindings.map((binding) => [binding.bindingId, binding]));
  return new Map(proposals.map((proposal) => {
    const evidence = proposal.evidence.map((selection) => {
      const binding = bindingById.get(selection.bindingId);
      if (!binding) {
        throw new AiStorySceneGroundingError(
          "SCENE_GROUNDING_BINDING_INVALID",
          `Scene ${proposal.sceneId} selected an unaccepted Asset binding`,
        );
      }
      const allowedFacts = new Set([
        ...binding.observedFacts,
        ...binding.namedItems,
        ...binding.productCandidates.map((candidate) => candidate.name),
        ...binding.productCandidates.flatMap((candidate) => candidate.evidence),
      ].map(normalized));
      if (selection.groundedFacts.some((fact) => !allowedFacts.has(normalized(fact)))) {
        throw new AiStorySceneGroundingError(
          "SCENE_GROUNDING_UNSUPPORTED_CLAIM",
          `Scene ${proposal.sceneId} contains a fact not backed by binding ${binding.bindingId}`,
        );
      }
      return {
        bindingId: binding.bindingId,
        assetId: binding.assetId,
        role: binding.role,
        semanticSnapshotId: binding.analysisSnapshotId,
        groundedFacts: selection.groundedFacts,
      };
    });
    const selectedBindings = evidence.map((item) => bindingById.get(item.bindingId)!);
    for (const claim of proposal.visualClaims) {
      const sources = selectedBindings.filter((binding) =>
        binding.namedItems.some((item) => normalized(item) === normalized(claim.subject)) ||
        binding.productCandidates.some((candidate) => normalized(candidate.name) === normalized(claim.subject)) ||
        binding.observedFacts.some((fact) => namesObservedSubject(fact, claim.subject)),
      );
      if (sources.length === 0) {
        throw new AiStorySceneGroundingError(
          "SCENE_GROUNDING_UNSUPPORTED_CLAIM",
          `Scene ${proposal.sceneId} names unsupported visual subject ${claim.subject}`,
        );
      }
      if (
        claim.evidenceLevel === "EXISTENCE_ONLY" &&
        normalized(claim.detail) !== normalized(claim.subject)
      ) {
        throw new AiStorySceneGroundingError(
          "SCENE_GROUNDING_UNSUPPORTED_CLAIM",
          `Scene ${proposal.sceneId} may not attach appearance detail to existence-only evidence for ${claim.subject}`,
        );
      }
      if (claim.evidenceLevel === "OBSERVED_APPEARANCE") {
        const productSource = sources.find((binding) =>
          binding.role === "PRODUCT_AUTHORITY" &&
          binding.productCandidates.some((candidate) =>
            normalized(candidate.name) === normalized(claim.subject) &&
            candidate.relationship !== "CATALOG_CHOICE"
          ),
        );
        if (!productSource || !productSource.observedFacts.some((fact) => normalized(fact) === normalized(claim.detail))) {
          throw new AiStorySceneGroundingError(
            "SCENE_GROUNDING_UNSUPPORTED_CLAIM",
            `Scene ${proposal.sceneId} claims unsupported appearance for ${claim.subject}`,
          );
        }
      }
    }
    return [proposal.sceneId, AiStorySceneGroundingLineageSchema.parse({
      contractVersion: AI_STORY_SCENE_GROUNDING_LINEAGE_VERSION,
      storyId: context.storyId,
      storyVersionId: context.storyVersionId,
      matchingResultId: context.matchingResultId,
      narrativeIntent: proposal.narrativeIntent,
      visualIntent: proposal.visualIntent,
      evidence,
      visualClaims: proposal.visualClaims,
    })] as const;
  }));
}
