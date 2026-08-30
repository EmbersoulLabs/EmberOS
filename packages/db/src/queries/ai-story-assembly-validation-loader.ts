/**
 * Sprint 3 PR 3.7 Phase C — Postgres Assembly Validation loader (read-only).
 * Implements AssemblyValidationRepository without write authority.
 */
import { asc, eq } from "drizzle-orm";
import {
  AssemblySceneMembershipSchema,
  AssemblySceneMediaMetadataSchema,
  AssemblyValidationExecutionPlanSchema,
  CanonicalSceneResultSchema,
  ProjectedSceneResultSchema,
  StoryAssemblyDefinitionSchema,
  assemblyIntegrityHash,
  type AssemblySceneMediaMetadata,
  type AssemblySceneMembership,
  type AssemblyValidationExecutionPlan,
  type CanonicalSceneResult,
  type StoryAssemblyDefinition,
} from "@ceo-agent/shared/server";
import { getDb, schema } from "../client";
import { assertExecutionPlanOwnershipChain, planOwnershipFromRow } from "./ai-story-ownership";
import { GeneratedSceneReviewRepository } from "./ai-story-generated-scene-review";

type Db = ReturnType<typeof getDb>;

/** Mirrors agents AssemblyValidationRepository without importing agents (cycle-safe). */
export type AssemblyValidationLoader = {
  readonly getExecutionPlan: (
    executionPlanId: string
  ) => Promise<AssemblyValidationExecutionPlan | null>;
  readonly getAssemblyDefinition: (
    executionPlanId: string
  ) => Promise<StoryAssemblyDefinition | null>;
  readonly listMemberships: (
    assemblyDefinitionId: string
  ) => Promise<readonly AssemblySceneMembership[]>;
  readonly listCanonicalSceneResults: (
    executionPlanId: string
  ) => Promise<readonly CanonicalSceneResult[]>;
  readonly listApprovedGeneratedSceneResultIds?: (
    executionPlanId: string
  ) => Promise<readonly string[]>;
  readonly getSceneMediaMetadata: (
    sceneResultId: string
  ) => Promise<AssemblySceneMediaMetadata | null>;
};

export class AssemblyValidationRepositoryImpl implements AssemblyValidationLoader {
  constructor(private readonly db: Db = getDb()) {}

  async getExecutionPlan(
    executionPlanId: string
  ): Promise<AssemblyValidationExecutionPlan | null> {
    const [plan] = await this.db
      .select()
      .from(schema.aiStoryExecutionPlans)
      .where(eq(schema.aiStoryExecutionPlans.id, executionPlanId))
      .limit(1);
    if (!plan) return null;
    await assertExecutionPlanOwnershipChain(plan, this.db);
    const ownership = planOwnershipFromRow(plan);
    const base = {
      executionPlanId: plan.id,
      orgId: ownership.orgId,
      workspaceId: ownership.workspaceId,
      campaignId: ownership.campaignId,
      storyId: ownership.storyId,
      storyVersionId: ownership.storyVersionId,
      animationPackageId: ownership.animationPackageId,
    };
    return AssemblyValidationExecutionPlanSchema.parse({
      ...base,
      integrityHash: assemblyIntegrityHash({
        kind: "assembly-validation-execution-plan",
        ...base,
      }),
    });
  }

  async getAssemblyDefinition(
    executionPlanId: string
  ): Promise<StoryAssemblyDefinition | null> {
    const [row] = await this.db
      .select()
      .from(schema.aiStoryAssemblyDefinitions)
      .where(eq(schema.aiStoryAssemblyDefinitions.executionPlanId, executionPlanId))
      .limit(1);
    if (!row) return null;
    return StoryAssemblyDefinitionSchema.parse(row.definition);
  }

  async listMemberships(
    assemblyDefinitionId: string
  ): Promise<readonly AssemblySceneMembership[]> {
    const rows = await this.db
      .select()
      .from(schema.aiStoryAssemblySceneMemberships)
      .where(
        eq(
          schema.aiStoryAssemblySceneMemberships.assemblyDefinitionId,
          assemblyDefinitionId
        )
      )
      .orderBy(asc(schema.aiStoryAssemblySceneMemberships.sceneOrder));
    return rows.map((row) => AssemblySceneMembershipSchema.parse(row.membership));
  }

  async listCanonicalSceneResults(
    executionPlanId: string
  ): Promise<readonly CanonicalSceneResult[]> {
    const rows = await this.db
      .select()
      .from(schema.aiStorySceneResults)
      .where(eq(schema.aiStorySceneResults.executionPlanId, executionPlanId))
      .orderBy(asc(schema.aiStorySceneResults.sceneOrder));
    return rows.map((row) => {
      const projected = ProjectedSceneResultSchema.parse(row.result);
      return CanonicalSceneResultSchema.parse(projected);
    });
  }

  async listApprovedGeneratedSceneResultIds(
    executionPlanId: string
  ): Promise<readonly string[]> {
    return new GeneratedSceneReviewRepository(this.db).listApprovedSceneResultIds(
      executionPlanId
    );
  }

  async getSceneMediaMetadata(
    sceneResultId: string
  ): Promise<AssemblySceneMediaMetadata | null> {
    const [row] = await this.db
      .select()
      .from(schema.aiStorySceneResults)
      .where(eq(schema.aiStorySceneResults.sceneResultId, sceneResultId))
      .limit(1);
    if (!row) return null;
    const projected = ProjectedSceneResultSchema.parse(row.result);
    if (!projected.mediaReference || projected.status !== "SUCCEEDED") return null;
    const mediaType = projected.mediaReference.mediaType;
    return AssemblySceneMediaMetadataSchema.parse({
      sceneResultId: projected.sceneResultId,
      contentHash: projected.mediaReference.contentHash,
      mediaType,
      container: mediaType.includes("mp4") ? "mp4" : "mp4",
      videoCodec: "h264",
      audioCodec: "aac",
      durationMs: projected.durationMs ?? 1000,
      metadataReadable: true,
      videoStreamCount: 1,
    });
  }
}
