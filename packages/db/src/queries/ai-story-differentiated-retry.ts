import { and, asc, eq, sql } from "drizzle-orm";
import {
  AI_STORY_DIFFERENTIATED_RETRY_CONTRACT_VERSION,
  AI_STORY_MAX_HUMAN_AUTHORIZED_ATTEMPTS,
  GeneratedSceneReviewFactSchema,
  SceneAttemptInputRevisionFactSchema,
  SceneRetryAuthorizationFactSchema,
  SceneRetryEligibilityFactSchema,
  isMateriallyDifferentiated,
  type HumanCreativeRejectionReason,
  type SceneAttemptInputRevisionFact,
  type SceneRetryAuthorizationFact,
  type SceneRetryCreativeDirection,
  type SceneRetryEligibilityFact,
} from "@ceo-agent/shared";
import { getDb, schema } from "../client";
import { canonicalPersistenceHash, deterministicPersistenceUuid } from "./ai-story-scene-execution-persistence";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export class DifferentiatedRetryError extends Error {
  constructor(readonly code: string, message: string, readonly status = 409) {
    super(message); this.name = "DifferentiatedRetryError";
  }
}

function fingerprint(kind: string, value: object): string {
  return canonicalPersistenceHash({ kind, ...value });
}

export class DifferentiatedRetryRepository {
  constructor(private readonly db: Db = getDb(), private readonly now: () => Date = () => new Date()) {}

  async rejectCreative(input: {
    executionPlanId: string; sceneExecutionId: string; workspaceId: string; actorUserId: string;
    reason: HumanCreativeRejectionReason; note?: string;
  }): Promise<{ reviewId: string; eligibility: SceneRetryEligibilityFact }> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`set local lock_timeout='5s'`);
      const snapshot = await this.lockAuthority(tx, input);
      if (snapshot.review.decision === "REJECTED") {
        const existing = await this.getEligibilityInTx(tx, snapshot.review.generatedSceneReviewId);
        if (!existing) throw new DifferentiatedRetryError("RETRY_ELIGIBILITY_MISSING", "Rejected review is missing retry eligibility");
        return { reviewId: snapshot.review.generatedSceneReviewId, eligibility: existing };
      }
      if (snapshot.review.decision !== "PENDING_REVIEW") throw new DifferentiatedRetryError("REVIEW_NOT_PENDING", "Only a pending generated result can be creatively rejected");
      if (snapshot.result.status !== "SUCCEEDED" || snapshot.attempt.status !== "SUCCEEDED") throw new DifferentiatedRetryError("PROVIDER_TRUTH_NOT_SUCCEEDED", "Creative rejection requires a technically succeeded attempt");
      const decidedAt = this.now().toISOString();
      const rationale = JSON.stringify({ reason: input.reason, ...(input.note ? { note: input.note } : {}) });
      const nextAttemptNumber = snapshot.attemptCount + 1;
      const eligibility = nextAttemptNumber <= AI_STORY_MAX_HUMAN_AUTHORIZED_ATTEMPTS ? "ELIGIBLE" : "INELIGIBLE_MAX_ATTEMPTS";
      const updatedFact = GeneratedSceneReviewFactSchema.parse({ ...snapshot.review.fact, decision: "REJECTED", decidedBy: input.actorUserId, decidedAt, rationale });
      await tx.update(schema.aiStoryGeneratedSceneReviews).set({
        decision: "REJECTED", decidedBy: input.actorUserId, decidedAt: new Date(decidedAt), rationale,
        fact: updatedFact, updatedAt: new Date(decidedAt),
      }).where(and(eq(schema.aiStoryGeneratedSceneReviews.generatedSceneReviewId, snapshot.review.generatedSceneReviewId), eq(schema.aiStoryGeneratedSceneReviews.decision, "PENDING_REVIEW")));
      const seed = { sceneExecutionId: input.sceneExecutionId, sourceReviewId: snapshot.review.generatedSceneReviewId, sourceAttemptId: snapshot.review.providerAttemptId, eligibility, nextAttemptNumber: eligibility === "ELIGIBLE" ? nextAttemptNumber : null, reason: input.reason };
      const fact = SceneRetryEligibilityFactSchema.parse({
        retryEligibilityId: deterministicPersistenceUuid("ai-story-scene-retry-eligibility", seed),
        orgId: snapshot.scene.orgId, workspaceId: snapshot.scene.workspaceId, campaignId: snapshot.scene.campaignId,
        storyId: snapshot.scene.storyId, executionPlanId: snapshot.scene.executionPlanId, sceneExecutionId: snapshot.scene.id,
        sourceReviewId: snapshot.review.generatedSceneReviewId, sourceAttemptId: snapshot.review.providerAttemptId,
        eligibility, nextAttemptNumber: eligibility === "ELIGIBLE" ? nextAttemptNumber : null, reason: input.reason,
        canonicalFingerprint: fingerprint("ai-story-scene-retry-eligibility", seed), evaluatedAt: decidedAt,
        contractVersion: AI_STORY_DIFFERENTIATED_RETRY_CONTRACT_VERSION,
      });
      await tx.insert(schema.aiStorySceneRetryEligibilityFacts).values({
        retryEligibilityId: fact.retryEligibilityId, orgId: fact.orgId, workspaceId: fact.workspaceId,
        campaignId: fact.campaignId, storyId: fact.storyId, executionPlanId: fact.executionPlanId,
        sceneExecutionId: fact.sceneExecutionId, sourceReviewId: fact.sourceReviewId, sourceAttemptId: fact.sourceAttemptId,
        eligibility: fact.eligibility, nextAttemptNumber: fact.nextAttemptNumber, reason: fact.reason,
        canonicalFingerprint: fact.canonicalFingerprint, evaluatedAt: new Date(fact.evaluatedAt),
        contractVersion: fact.contractVersion, fact,
      }).onConflictDoNothing();
      return { reviewId: snapshot.review.generatedSceneReviewId, eligibility: fact };
    });
  }

  async createInputRevision(input: {
    executionPlanId: string; sceneExecutionId: string; workspaceId: string; actorUserId: string;
    sourceReviewId: string; creativeDirection: SceneRetryCreativeDirection;
    expectedProductAssetId: string;
    productAuthorityHash: string; visualAuthorityCertificationHash: string;
  }): Promise<SceneAttemptInputRevisionFact> {
    return this.db.transaction(async (tx) => {
      const snapshot = await this.lockAuthority(tx, input);
      if (snapshot.review.generatedSceneReviewId !== input.sourceReviewId || snapshot.review.decision !== "REJECTED") throw new DifferentiatedRetryError("REVIEW_NOT_REJECTED", "Retry revision requires the exact rejected review");
      if (snapshot.result.status !== "SUCCEEDED" || snapshot.attempt.status !== "SUCCEEDED") throw new DifferentiatedRetryError("PROVIDER_TRUTH_NOT_SUCCEEDED", "Retry revision requires a technically succeeded source attempt");
      const eligibility = await this.getEligibilityInTx(tx, input.sourceReviewId);
      if (!eligibility || eligibility.eligibility !== "ELIGIBLE" || !eligibility.nextAttemptNumber) throw new DifferentiatedRetryError("RETRY_INELIGIBLE", "Rejected result is not retry eligible");
      const source = creativeDirectionFromInstructions(snapshot.instructions);
      if (!isMateriallyDifferentiated({ source, candidate: input.creativeDirection, reason: eligibility.reason })) throw new DifferentiatedRetryError("RETRY_INPUT_NOT_DIFFERENTIATED", "Retry input is not materially differentiated");
      const productAssetId = snapshot.intent.referencedAssetIds?.[0];
      if (!productAssetId) throw new DifferentiatedRetryError("PRODUCT_AUTHORITY_MISSING", "Campaign Product Asset is missing");
      if (productAssetId !== input.expectedProductAssetId) throw new DifferentiatedRetryError("PRODUCT_AUTHORITY_CONFLICT", "Retry certification does not match the Campaign Product Asset");
      const parent = await this.ensureBaseRevision(tx, snapshot, input.actorUserId, eligibility.reason, source, input.productAuthorityHash, input.visualAuthorityCertificationHash);
      const seed = { sceneExecutionId: input.sceneExecutionId, revisionNumber: eligibility.nextAttemptNumber, parentRevisionId: parent.retryInputRevisionId, sourceAttemptId: eligibility.sourceAttemptId, sourceReviewId: input.sourceReviewId, creativeDirection: input.creativeDirection, productAssetId, productAuthorityHash: input.productAuthorityHash, visualAuthorityCertificationHash: input.visualAuthorityCertificationHash, providerModeRequirement: "FIRST_FRAME_I2V" };
      const createdAt = this.now().toISOString();
      const fact = SceneAttemptInputRevisionFactSchema.parse({
        retryInputRevisionId: deterministicPersistenceUuid("ai-story-scene-attempt-input-revision", seed),
        orgId: snapshot.scene.orgId, workspaceId: snapshot.scene.workspaceId, campaignId: snapshot.scene.campaignId,
        storyId: snapshot.scene.storyId, executionPlanId: snapshot.scene.executionPlanId, sceneExecutionId: snapshot.scene.id,
        revisionNumber: eligibility.nextAttemptNumber, parentRevisionId: parent.retryInputRevisionId,
        sourceAttemptId: eligibility.sourceAttemptId, sourceReviewId: input.sourceReviewId, retryReason: eligibility.reason,
        creativeDirection: input.creativeDirection, productAssetId, productAuthorityHash: input.productAuthorityHash,
        visualAuthorityCertificationHash: input.visualAuthorityCertificationHash, providerModeRequirement: "FIRST_FRAME_I2V",
        canonicalFingerprint: fingerprint("ai-story-scene-attempt-input-revision", seed), createdBy: input.actorUserId,
        createdAt, contractVersion: AI_STORY_DIFFERENTIATED_RETRY_CONTRACT_VERSION,
      });
      await this.insertRevision(tx, fact);
      return (await this.getRevisionInTx(tx, fact.retryInputRevisionId))!;
    });
  }

  async authorizeRetry(input: { executionPlanId: string; sceneExecutionId: string; workspaceId: string; actorUserId: string; sourceReviewId: string; retryInputRevisionId: string }): Promise<SceneRetryAuthorizationFact> {
    return this.db.transaction(async (tx) => {
      const snapshot = await this.lockAuthority(tx, input);
      if (snapshot.review.generatedSceneReviewId !== input.sourceReviewId || snapshot.review.decision !== "REJECTED") throw new DifferentiatedRetryError("REVIEW_NOT_REJECTED", "Retry authorization requires the exact rejected review");
      if (snapshot.result.status !== "SUCCEEDED" || snapshot.attempt.status !== "SUCCEEDED") throw new DifferentiatedRetryError("PROVIDER_TRUTH_NOT_SUCCEEDED", "Retry authorization requires a technically succeeded source attempt");
      const eligibility = await this.getEligibilityInTx(tx, input.sourceReviewId);
      const revision = await this.getRevisionInTx(tx, input.retryInputRevisionId);
      if (!eligibility || eligibility.eligibility !== "ELIGIBLE" || !eligibility.nextAttemptNumber) throw new DifferentiatedRetryError("RETRY_INELIGIBLE", "Retry is not eligible");
      if (!revision || revision.sceneExecutionId !== input.sceneExecutionId || revision.executionPlanId !== input.executionPlanId || revision.sourceReviewId !== input.sourceReviewId || revision.sourceAttemptId !== eligibility.sourceAttemptId || revision.revisionNumber !== eligibility.nextAttemptNumber || revision.workspaceId !== input.workspaceId) throw new DifferentiatedRetryError("RETRY_INPUT_AUTHORITY_CONFLICT", "Retry input revision does not match eligibility authority");
      const seed = { sceneExecutionId: input.sceneExecutionId, sourceReviewId: input.sourceReviewId, sourceAttemptId: eligibility.sourceAttemptId, authorizedAttemptNumber: eligibility.nextAttemptNumber, retryInputRevisionId: revision.retryInputRevisionId, retryInputFingerprint: revision.canonicalFingerprint };
      const authorizedAt = this.now().toISOString();
      const fact = SceneRetryAuthorizationFactSchema.parse({
        retryAuthorizationId: deterministicPersistenceUuid("ai-story-scene-retry-authorization", seed),
        orgId: snapshot.scene.orgId, workspaceId: snapshot.scene.workspaceId, campaignId: snapshot.scene.campaignId,
        storyId: snapshot.scene.storyId, executionPlanId: snapshot.scene.executionPlanId, sceneExecutionId: snapshot.scene.id,
        sourceReviewId: input.sourceReviewId, sourceAttemptId: eligibility.sourceAttemptId,
        authorizedAttemptNumber: eligibility.nextAttemptNumber, authorizedBy: input.actorUserId, authorizedAt,
        reason: eligibility.reason, retryInputRevisionId: revision.retryInputRevisionId,
        retryInputFingerprint: revision.canonicalFingerprint, status: "AUTHORIZED",
        canonicalFingerprint: fingerprint("ai-story-scene-retry-authorization", seed),
        contractVersion: AI_STORY_DIFFERENTIATED_RETRY_CONTRACT_VERSION,
      });
      await tx.insert(schema.aiStorySceneRetryAuthorizations).values({
        retryAuthorizationId: fact.retryAuthorizationId, orgId: fact.orgId, workspaceId: fact.workspaceId,
        campaignId: fact.campaignId, storyId: fact.storyId, executionPlanId: fact.executionPlanId,
        sceneExecutionId: fact.sceneExecutionId, sourceReviewId: fact.sourceReviewId, sourceAttemptId: fact.sourceAttemptId,
        authorizedAttemptNumber: fact.authorizedAttemptNumber, authorizedBy: fact.authorizedBy,
        authorizedAt: new Date(fact.authorizedAt), reason: fact.reason, retryInputRevisionId: fact.retryInputRevisionId,
        retryInputFingerprint: fact.retryInputFingerprint, status: fact.status, canonicalFingerprint: fact.canonicalFingerprint,
        contractVersion: fact.contractVersion, fact,
      }).onConflictDoNothing();
      const [row] = await tx.select().from(schema.aiStorySceneRetryAuthorizations).where(and(eq(schema.aiStorySceneRetryAuthorizations.sceneExecutionId, input.sceneExecutionId), eq(schema.aiStorySceneRetryAuthorizations.authorizedAttemptNumber, eligibility.nextAttemptNumber))).limit(1);
      if (!row || row.canonicalFingerprint !== fact.canonicalFingerprint) throw new DifferentiatedRetryError("RETRY_AUTHORIZATION_CONFLICT", "A conflicting retry authorization already exists");
      return SceneRetryAuthorizationFactSchema.parse(row.fact);
    });
  }

  async getRevision(id: string) { return this.getRevisionInTx(this.db, id); }
  async getAuthorization(id: string) { const [row] = await this.db.select().from(schema.aiStorySceneRetryAuthorizations).where(eq(schema.aiStorySceneRetryAuthorizations.retryAuthorizationId,id)).limit(1); return row ? SceneRetryAuthorizationFactSchema.parse(row.fact) : null; }
  async markAuthorizationConsumed(id:string):Promise<SceneRetryAuthorizationFact>{
    return this.db.transaction(async(tx)=>{const [row]=await tx.select().from(schema.aiStorySceneRetryAuthorizations).where(eq(schema.aiStorySceneRetryAuthorizations.retryAuthorizationId,id)).limit(1);if(!row)throw new DifferentiatedRetryError("RETRY_AUTHORIZATION_NOT_FOUND","Retry authorization not found",404);const current=SceneRetryAuthorizationFactSchema.parse(row.fact);if(current.status==="CONSUMED")return current;const fact=SceneRetryAuthorizationFactSchema.parse({...current,status:"CONSUMED"});await tx.update(schema.aiStorySceneRetryAuthorizations).set({status:"CONSUMED",fact}).where(and(eq(schema.aiStorySceneRetryAuthorizations.retryAuthorizationId,id),eq(schema.aiStorySceneRetryAuthorizations.status,"AUTHORIZED")));return fact;});
  }

  private async lockAuthority(tx: Tx, input: {executionPlanId:string;sceneExecutionId:string;workspaceId:string}) {
    await tx.execute(sql`select id from ai_story_scene_executions where id=${input.sceneExecutionId}::uuid and execution_plan_id=${input.executionPlanId}::uuid for update`);
    const [scene] = await tx.select().from(schema.aiStorySceneExecutions).where(and(eq(schema.aiStorySceneExecutions.id,input.sceneExecutionId),eq(schema.aiStorySceneExecutions.executionPlanId,input.executionPlanId))).limit(1);
    if (!scene || scene.workspaceId !== input.workspaceId) throw new DifferentiatedRetryError("RETRY_ACCESS_DENIED","Scene retry authority not found",404);
    const reviews = await tx.select().from(schema.aiStoryGeneratedSceneReviews).where(eq(schema.aiStoryGeneratedSceneReviews.sceneExecutionId,input.sceneExecutionId)).orderBy(asc(schema.aiStoryGeneratedSceneReviews.createdAt));
    const review = reviews[reviews.length-1]; if (!review) throw new DifferentiatedRetryError("REVIEW_NOT_FOUND","Generated review not found",404);
    const [result] = await tx.select().from(schema.aiStorySceneResults).where(eq(schema.aiStorySceneResults.providerAttemptId,review.providerAttemptId)).limit(1);
    const [attempt] = await tx.select().from(schema.providerAttempts).where(eq(schema.providerAttempts.attemptId,review.providerAttemptId)).limit(1);
    const [instruction] = await tx.select().from(schema.aiStorySceneInstructionSnapshots).where(eq(schema.aiStorySceneInstructionSnapshots.contentHash,scene.instructionHash)).limit(1);
    const correlations = await tx.select().from(schema.aiStorySceneSchedulingCorrelations).where(eq(schema.aiStorySceneSchedulingCorrelations.sceneExecutionId,input.sceneExecutionId));
    if (!result || !attempt || !instruction) throw new DifferentiatedRetryError("RETRY_SOURCE_INCOMPLETE","Retry source authority is incomplete");
    return { scene, review, result, attempt, instructions: instruction.instructions, intent: scene.intent, attemptCount: correlations.length };
  }

  private async getEligibilityInTx(db: Db|Tx, reviewId:string) { const [row]=await db.select().from(schema.aiStorySceneRetryEligibilityFacts).where(eq(schema.aiStorySceneRetryEligibilityFacts.sourceReviewId,reviewId)).limit(1); return row ? SceneRetryEligibilityFactSchema.parse(row.fact) : null; }
  private async getRevisionInTx(db: Db|Tx,id:string) { const [row]=await db.select().from(schema.aiStorySceneAttemptInputRevisions).where(eq(schema.aiStorySceneAttemptInputRevisions.retryInputRevisionId,id)).limit(1); return row ? SceneAttemptInputRevisionFactSchema.parse(row.fact) : null; }
  private async insertRevision(tx:Tx,fact:SceneAttemptInputRevisionFact) { await tx.insert(schema.aiStorySceneAttemptInputRevisions).values({retryInputRevisionId:fact.retryInputRevisionId,orgId:fact.orgId,workspaceId:fact.workspaceId,campaignId:fact.campaignId,storyId:fact.storyId,executionPlanId:fact.executionPlanId,sceneExecutionId:fact.sceneExecutionId,revisionNumber:fact.revisionNumber,parentRevisionId:fact.parentRevisionId,sourceAttemptId:fact.sourceAttemptId,sourceReviewId:fact.sourceReviewId,retryReason:fact.retryReason,creativeDirection:fact.creativeDirection,productAssetId:fact.productAssetId,productAuthorityHash:fact.productAuthorityHash,visualAuthorityCertificationHash:fact.visualAuthorityCertificationHash,providerModeRequirement:fact.providerModeRequirement,canonicalFingerprint:fact.canonicalFingerprint,createdBy:fact.createdBy,createdAt:new Date(fact.createdAt),contractVersion:fact.contractVersion,fact}).onConflictDoNothing(); }
  private async ensureBaseRevision(tx:Tx,snapshot:Awaited<ReturnType<DifferentiatedRetryRepository["lockAuthority"]>>,actor:string,reason:HumanCreativeRejectionReason,direction:SceneRetryCreativeDirection,productHash:string,certHash:string) {
    const [existing]=await tx.select().from(schema.aiStorySceneAttemptInputRevisions).where(and(eq(schema.aiStorySceneAttemptInputRevisions.sceneExecutionId,snapshot.scene.id),eq(schema.aiStorySceneAttemptInputRevisions.revisionNumber,1))).limit(1); if(existing)return SceneAttemptInputRevisionFactSchema.parse(existing.fact);
    const productAssetId=snapshot.intent.referencedAssetIds[0]; const seed={sceneExecutionId:snapshot.scene.id,revisionNumber:1,sourceAttemptId:snapshot.review.providerAttemptId,sourceReviewId:snapshot.review.generatedSceneReviewId,creativeDirection:direction,productAssetId,productAuthorityHash:productHash,visualAuthorityCertificationHash:certHash,providerModeRequirement:"FIRST_FRAME_I2V"}; const createdAt=this.now().toISOString();
    const fact=SceneAttemptInputRevisionFactSchema.parse({retryInputRevisionId:deterministicPersistenceUuid("ai-story-scene-attempt-input-revision",seed),orgId:snapshot.scene.orgId,workspaceId:snapshot.scene.workspaceId,campaignId:snapshot.scene.campaignId,storyId:snapshot.scene.storyId,executionPlanId:snapshot.scene.executionPlanId,sceneExecutionId:snapshot.scene.id,revisionNumber:1,parentRevisionId:null,sourceAttemptId:snapshot.review.providerAttemptId,sourceReviewId:snapshot.review.generatedSceneReviewId,retryReason:reason,creativeDirection:direction,productAssetId,productAuthorityHash:productHash,visualAuthorityCertificationHash:certHash,providerModeRequirement:"FIRST_FRAME_I2V",canonicalFingerprint:fingerprint("ai-story-scene-attempt-input-revision",seed),createdBy:actor,createdAt,contractVersion:AI_STORY_DIFFERENTIATED_RETRY_CONTRACT_VERSION}); await this.insertRevision(tx,fact); return fact;
  }
}

export function creativeDirectionFromInstructions(instructions:any): SceneRetryCreativeDirection {
  const shot=instructions.shots?.[0]??{};
  return { visualRole:String(instructions.purpose??shot.information??"SCENE PURPOSE"), cameraInstruction:String(shot.cameraMovement??instructions.transition??"STATIC"), focusProgression:[String(shot.focus??"PRIMARY SUBJECT"),String(shot.composition??"BALANCED COMPOSITION")], shotEmphasis:String(shot.information??instructions.purpose??"PRODUCT") };
}
