import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AiStoryEffectiveSceneGenerationAuthoritySchema,
  AiStoryEffectiveSceneGenerationAuthorityV2Schema,
  AiStoryLocalGenerationPackageSchema,
  AiStoryLocalGenerationPackageV3Schema,
  type AiStoryLocalGenerationPackageV3,
} from "@ceo-agent/shared";
import {
  computeAiStoryLocalGenerationPackageV3Fingerprint,
  computeAiStoryLocalPredecessorAuthorityFingerprint,
  computeAiStoryLocalReleaseAuthorityFingerprint,
  deterministicAiStoryLocalGenerationPackageV3Id,
  deterministicAiStoryLocalReleaseAuthorityId,
  deterministicAiStoryLocalSuccessorPackageV3Id,
} from "@ceo-agent/shared/server";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const id = (suffix: string) => `60000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const hash = (seed: string) => `sha256:${createHash("sha256").update(seed).digest("hex")}`;
const auditTime = "2026-10-04T00:00:00.000Z";

function historicalBase() {
  return {
    packageId: id("1"),
    packageFingerprint: hash("historical-package"),
    executionMode: "MANUAL_LOCAL" as const,
    organizationId: id("2"),
    workspaceId: id("3"),
    campaignId: id("4"),
    storyId: id("5"),
    storyVersionId: id("6"),
    executionPlanId: id("7"),
    runtimeAuthorizationId: id("8"),
    unitId: id("9"),
    sceneExecutionId: id("9"),
    sceneId: "scene-1",
    order: 1,
    durationSec: 5,
    aspectRatio: "9:16" as const,
    resolutionIntent: "720p" as const,
    recommendedWorkflow: "GENERIC_LOCAL_VIDEO" as const,
    generationMode: "TEXT_TO_VIDEO" as const,
    prompt: "An authorized reference-free scene.",
    negativePrompt: "",
    dialogue: [],
    generateAudio: false,
    audioBlocked: true,
    characterAuthority: null,
    productAuthority: null,
    worldDescription: "A quiet room.",
    mustKeep: [],
    mustAvoid: [],
    qcRequirements: [],
    continuityRequirements: [],
    previousUnitEndState: [],
    currentUnitStartState: [],
    expectedEndState: [],
    references: [],
    planningAuthority: {
      planningLineageSource: "FROZEN_SCRIPT_DIRECTOR" as const,
      sceneVersion: 1,
      scriptVersionId: id("10"),
      handoffId: id("11"),
      handoffFingerprint: hash("handoff"),
    },
    instructions: "Generate the exact authorized scene.",
    state: "AWAITING_LOCAL_OUTPUT" as const,
    retryOfPackageId: null,
    retryNumber: 0,
    createdAt: auditTime,
  };
}

function historicalV1() {
  return {
    ...historicalBase(),
    version: "local-generation-package.v1" as const,
    sourceAuthority: {
      schedulingAuthorityId: id("20"),
      schedulingAuthorityFingerprint: hash("schedule"),
      plannerSnapshotId: id("21"),
      compiledRequestId: id("22"),
      compiledRequestFingerprint: hash("compiled"),
      sceneFingerprint: hash("scene"),
      semanticPlanFingerprint: hash("semantic"),
      preGenerationQcEvaluationId: id("23"),
      preGenerationQcFingerprint: hash("qc"),
      directorFingerprint: hash("director"),
      motionFingerprint: hash("motion"),
      castSnapshotFingerprint: hash("cast"),
      locationSnapshotFingerprint: hash("location"),
      productSnapshotFingerprint: hash("product"),
    },
  };
}

function historicalV2() {
  return {
    ...historicalBase(),
    version: "local-generation-package.v2" as const,
    sourceAuthority: {
      version: "ai-story-local-generation-source-authority.v2" as const,
      localSourceAuthorityId: id("30"),
      localSourceAuthorityFingerprint: hash("source"),
      orgId: id("2"),
      workspaceId: id("3"),
      campaignId: id("4"),
      storyId: id("5"),
      storyVersionId: id("6"),
      executionPlanId: id("7"),
      runtimeAuthorizationId: id("8"),
      sceneExecutionId: id("9"),
      sceneExecutionFingerprint: hash("execution"),
      instructionContentHash: hash("instructions"),
      sceneVersionId: id("31"),
      sceneFingerprint: hash("scene"),
      generationAuthority: {
        strategy: "TEXT_TO_VIDEO" as const,
        referenceSource: "REFERENCE_FREE_T2V" as const,
        effectiveReferenceIds: [],
        firstFrameAssetId: null,
        productVisualIdentityRequirement: "NONE" as const,
      },
      generationAuthorityFingerprint: hash("generation"),
      preGenerationQcEvaluationId: id("23"),
      preGenerationQcFingerprint: hash("qc"),
      directorFingerprint: hash("director"),
      motionFingerprint: hash("motion"),
      scriptVersionId: id("10"),
      handoffId: id("11"),
      handoffFingerprint: hash("handoff"),
      characterAuthorityFingerprint: hash("character"),
      worldAuthorityFingerprint: hash("world"),
      productMaterialFingerprint: hash("product"),
      productMaterialSelection: null,
    },
  };
}

type V3Options = {
  continuitySeed?: string;
  productSeed?: string;
  characterSeed?: string;
  sameProductAndVisualAsset?: boolean;
  extractedAt?: string;
  releasedAt?: string;
  releasedBy?: string;
  predecessorGenerationResultSuffix?: string;
};

function v3Package(options: V3Options = {}): AiStoryLocalGenerationPackageV3 {
  const continuityAssetId = id("100");
  const continuityHash = hash(options.continuitySeed ?? "continuity-a");
  const productAssetId = options.sameProductAndVisualAsset ? continuityAssetId : id("101");
  const productHash = options.sameProductAndVisualAsset
    ? continuityHash
    : hash(options.productSeed ?? "product-a");
  const characterHash = hash(options.characterSeed ?? "character-a");
  const outputHash = hash("predecessor-output");
  const predecessorSemantic = {
    contractVersion: "ai-story-local-predecessor-authority.v1" as const,
    predecessorSceneExecutionId: id("110"),
    predecessorPackageId: id("111"),
    predecessorGenerationResultId: id(
      options.predecessorGenerationResultSuffix ?? "112",
    ),
    predecessorPostQcEvaluationId: id("113"),
    predecessorDecisionId: id("114"),
    predecessorOutputAssetId: id("115"),
    predecessorOutputContentHash: outputHash,
    continuityFrameAssetId: continuityAssetId,
    continuityFrameContentHash: continuityHash,
    continuitySourceContentHash: outputHash,
    extractionContractVersion: "ai-story-continuity-frame-extraction.v1",
  };
  const predecessorFingerprint =
    computeAiStoryLocalPredecessorAuthorityFingerprint(predecessorSemantic);
  const releaseSemantic = {
    contractVersion: "ai-story-scene-release-authority.v2" as const,
    executionMode: "MANUAL_LOCAL" as const,
    organizationId: id("2"),
    workspaceId: id("3"),
    executionPlanId: id("7"),
    runtimeAuthorizationId: id("8"),
    sceneExecutionId: id("120"),
    sceneOrder: 2,
    releaseRevision: 1,
    gateKind: "PREDECESSOR_CONTINUITY" as const,
    gateEvidenceFingerprint: predecessorFingerprint,
  };
  const releaseFingerprint =
    computeAiStoryLocalReleaseAuthorityFingerprint(releaseSemantic);
  const visualStartAuthority = {
    sourceType: "PREDECESSOR_CONTINUITY" as const,
    assetId: continuityAssetId,
    contentHash: continuityHash,
    mediaType: "image/png",
  };
  const effectiveReferenceIds = [...new Set([
    continuityAssetId,
    productAssetId,
    id("102"),
  ])];
  const draft: AiStoryLocalGenerationPackageV3 = {
    version: "local-generation-package.v3",
    packageId: id("999"),
    packageFingerprint: hash("placeholder"),
    executionMode: "MANUAL_LOCAL",
    organizationId: id("2"),
    workspaceId: id("3"),
    campaignId: id("4"),
    storyId: id("5"),
    storyVersionId: id("6"),
    executionPlanId: id("7"),
    runtimeAuthorizationId: id("8"),
    unitId: id("120"),
    sceneExecutionId: id("120"),
    sceneId: "scene-2",
    order: 2,
    durationSec: 5,
    aspectRatio: "9:16",
    resolutionIntent: "720p",
    recommendedWorkflow: "MINIMAX_H3_NATIVE_DIALOGUE",
    generationMode: "PRODUCT_GROUNDED_VIDEO",
    prompt: "Continue from the exact approved frame and preserve the Product.",
    negativePrompt: "",
    dialogue: [{
      speakerCharacterId: id("121"),
      speakerLabel: "Authorized Character",
      text: "Continue exactly.",
      offscreen: false,
      locale: "en-SG",
    }],
    generateAudio: true,
    audioBlocked: false,
    characterAuthority: {
      characterId: id("121"),
      characterVersionId: id("122"),
      dnaFingerprint: characterHash,
      sourcePhotoSentToVideoProvider: false,
    },
    productAuthority: {
      assetId: id("123"),
      contentHash: hash("product-source"),
      confirmedVariant: "Pavlova",
      selectedMaterialAssetId: productAssetId,
      selectedMaterialContentHash: productHash,
      selection: "SOURCE_ASSET",
    },
    visualStartAuthority,
    predecessorAuthority: {
      semantic: predecessorSemantic,
      semanticFingerprint: predecessorFingerprint,
      audit: { extractedAt: options.extractedAt ?? auditTime },
    },
    releaseAuthority: {
      releaseAuthorityId:
        deterministicAiStoryLocalReleaseAuthorityId(releaseFingerprint),
      semantic: releaseSemantic,
      semanticFingerprint: releaseFingerprint,
      audit: {
        releasedBy: options.releasedBy ?? id("130"),
        releasedAt: options.releasedAt ?? auditTime,
      },
    },
    worldDescription: "The same authorized kitchen.",
    mustKeep: ["Product identity", "Character identity"],
    mustAvoid: ["Product substitution"],
    qcRequirements: [],
    continuityRequirements: ["Begin from the approved predecessor frame"],
    previousUnitEndState: ["Approved predecessor result"],
    currentUnitStartState: ["Exact predecessor continuity frame"],
    expectedEndState: ["Ready for the next Unit"],
    references: [
      {
        role: "VISUAL_START",
        assetId: continuityAssetId,
        contentHash: continuityHash,
        authorityId: id("112"),
        displayName: "Continuity start frame",
        mediaType: "image/png",
      },
      {
        role: "PRODUCT_IDENTITY",
        assetId: productAssetId,
        contentHash: productHash,
        authorityId: id("123"),
        displayName: "Product reference",
        mediaType: "image/png",
      },
      {
        role: "CHARACTER_IDENTITY",
        assetId: id("102"),
        contentHash: characterHash,
        authorityId: id("122"),
        displayName: "Character reference",
        mediaType: "image/png",
      },
    ],
    sourceAuthority: {
      version: "ai-story-local-generation-source-authority.v3",
      localSourceAuthorityId: id("140"),
      localSourceAuthorityFingerprint: hash("source-v3"),
      orgId: id("2"),
      workspaceId: id("3"),
      campaignId: id("4"),
      storyId: id("5"),
      storyVersionId: id("6"),
      executionPlanId: id("7"),
      runtimeAuthorizationId: id("8"),
      sceneExecutionId: id("120"),
      sceneExecutionFingerprint: hash("execution-v3"),
      instructionContentHash: hash("instructions-v3"),
      sceneVersionId: id("141"),
      sceneFingerprint: hash("scene-v3"),
      generationAuthority: {
        contractVersion: "ai-story-effective-scene-generation-authority.v2",
        strategy: "PRODUCT_GROUNDED_VIDEO",
        referenceSource: "SCENE_EXPLICIT",
        effectiveReferenceIds,
        productReferenceAssetIds: [productAssetId],
        visualStartAuthority,
        productVisualIdentityRequirement: "REQUIRED",
      },
      generationAuthorityFingerprint: hash("generation-v2"),
      preGenerationQcEvaluationId: id("142"),
      preGenerationQcFingerprint: hash("qc-v3"),
      directorFingerprint: hash("director-v3"),
      motionFingerprint: hash("motion-v3"),
      scriptVersionId: id("10"),
      handoffId: id("11"),
      handoffFingerprint: hash("handoff"),
      characterAuthorityFingerprint: characterHash,
      worldAuthorityFingerprint: hash("world-v3"),
      productMaterialFingerprint: productHash,
      productMaterialSelection: null,
    },
    planningAuthority: {
      planningLineageSource: "FROZEN_SCRIPT_DIRECTOR",
      sceneVersion: 1,
      scriptVersionId: id("10"),
      handoffId: id("11"),
      handoffFingerprint: hash("handoff"),
    },
    instructions: "Use the separate continuity, Product, and Character references.",
    state: "AWAITING_LOCAL_OUTPUT",
    successorOfPackageId: id("150"),
    successorNumber: 1,
    retryOfPackageId: null,
    retryNumber: 0,
    createdAt: auditTime,
  };
  const packageFingerprint =
    computeAiStoryLocalGenerationPackageV3Fingerprint(draft);
  return AiStoryLocalGenerationPackageV3Schema.parse({
    ...draft,
    packageFingerprint,
    packageId:
      deterministicAiStoryLocalGenerationPackageV3Id(packageFingerprint),
  });
}

describe("Sequential Manual Local Package V3 Phase 1", () => {
  it("1. parses a historical V1 package unchanged", () => {
    expect(AiStoryLocalGenerationPackageSchema.parse(historicalV1()).version)
      .toBe("local-generation-package.v1");
  });

  it("2. parses a historical V2 package unchanged", () => {
    expect(AiStoryLocalGenerationPackageSchema.parse(historicalV2()).version)
      .toBe("local-generation-package.v2");
  });

  it("3. parses a V3 package", () => {
    const parsed = AiStoryLocalGenerationPackageSchema.parse(v3Package());
    expect(parsed.version).toBe("local-generation-package.v3");
  });

  it("4. lets Product reference and visual start use different Assets", () => {
    const parsed = AiStoryLocalGenerationPackageSchema.parse(v3Package());
    if (parsed.version !== "local-generation-package.v3") throw new Error("V3 expected");
    expect(parsed.references.map((reference) => reference.role)).toEqual([
      "VISUAL_START",
      "PRODUCT_IDENTITY",
      "CHARACTER_IDENTITY",
    ]);
    expect(parsed.visualStartAuthority.assetId)
      .not.toBe(parsed.productAuthority?.selectedMaterialAssetId);
  });

  it("5. keeps roles distinct when Product and visual start share one Asset", () => {
    const parsed = v3Package({ sameProductAndVisualAsset: true });
    const visual = parsed.references.find((item) => item.role === "VISUAL_START");
    const product = parsed.references.find((item) => item.role === "PRODUCT_IDENTITY");
    expect(visual?.assetId).toBe(product?.assetId);
    expect(visual?.role).not.toBe(product?.role);
  });

  it("6. requires predecessor authority for PREDECESSOR_CONTINUITY", () => {
    const valid = v3Package();
    expect(AiStoryLocalGenerationPackageV3Schema.safeParse({
      ...valid,
      predecessorAuthority: null,
    }).success).toBe(false);
  });

  it("7. requires visual continuity Asset and hash to match predecessor authority", () => {
    const valid = v3Package();
    expect(AiStoryLocalGenerationPackageV3Schema.safeParse({
      ...valid,
      visualStartAuthority: {
        ...valid.visualStartAuthority,
        contentHash: hash("wrong-continuity"),
      },
    }).success).toBe(false);
  });

  it("8. never infers visual start from Product authority", () => {
    const sameAsset = v3Package({ sameProductAndVisualAsset: true });
    expect(AiStoryLocalGenerationPackageV3Schema.safeParse({
      ...sameAsset,
      references: sameAsset.references.filter((item) => item.role !== "VISUAL_START"),
    }).success).toBe(false);
  });

  it("9. preserves historical firstFrameAssetId semantics", () => {
    const legacy = historicalV2().sourceAuthority.generationAuthority;
    expect(AiStoryEffectiveSceneGenerationAuthoritySchema.parse(legacy))
      .toHaveProperty("firstFrameAssetId", null);
  });

  it("10. separates Generation Authority V2 visual start from Product", () => {
    const current = v3Package().sourceAuthority.generationAuthority;
    const parsed =
      AiStoryEffectiveSceneGenerationAuthorityV2Schema.parse(current);
    expect(parsed).not.toHaveProperty("firstFrameAssetId");
    expect(parsed.visualStartAuthority.assetId)
      .not.toBe(parsed.productReferenceAssetIds[0]);
    expect(parsed.strategy).toBe("PRODUCT_GROUNDED_VIDEO");
  });

  it("11. excludes audit timestamps and transient actors from semantic identity", () => {
    const first = v3Package();
    const auditOnly = v3Package({
      extractedAt: "2026-10-05T01:02:03.000Z",
      releasedAt: "2026-10-06T04:05:06.000Z",
      releasedBy: id("9998"),
    });
    expect(computeAiStoryLocalGenerationPackageV3Fingerprint(auditOnly))
      .toBe(computeAiStoryLocalGenerationPackageV3Fingerprint(first));
    expect(deterministicAiStoryLocalSuccessorPackageV3Id(auditOnly))
      .toBe(deterministicAiStoryLocalSuccessorPackageV3Id(first));
  });

  it("12. changes semantic fingerprint when continuity hash changes", () => {
    const first = v3Package();
    expect(computeAiStoryLocalGenerationPackageV3Fingerprint(
      v3Package({ continuitySeed: "continuity-b" }),
    )).not.toBe(computeAiStoryLocalGenerationPackageV3Fingerprint(first));
  });

  it("13. changes semantic fingerprint when Product authority changes", () => {
    const first = v3Package();
    expect(computeAiStoryLocalGenerationPackageV3Fingerprint(
      v3Package({ productSeed: "product-b" }),
    )).not.toBe(computeAiStoryLocalGenerationPackageV3Fingerprint(first));
  });

  it("14. changes semantic fingerprint when Character authority changes", () => {
    const first = v3Package();
    expect(computeAiStoryLocalGenerationPackageV3Fingerprint(
      v3Package({ characterSeed: "character-b" }),
    )).not.toBe(computeAiStoryLocalGenerationPackageV3Fingerprint(first));
  });

  it("15. converges successor identity for identical semantic authority", () => {
    const first = v3Package();
    expect(deterministicAiStoryLocalSuccessorPackageV3Id(v3Package()))
      .toBe(deterministicAiStoryLocalSuccessorPackageV3Id(first));
  });

  it("16. creates a different successor identity for different predecessor lineage", () => {
    const first = v3Package();
    const changed = v3Package({ predecessorGenerationResultSuffix: "9112" });
    expect(deterministicAiStoryLocalSuccessorPackageV3Id(changed))
      .not.toBe(deterministicAiStoryLocalSuccessorPackageV3Id(first));
  });

  it("17. uses an extensible registry and rejects an unsupported local workflow", () => {
    const valid = v3Package();
    expect(AiStoryLocalGenerationPackageV3Schema.safeParse({
      ...valid,
      recommendedWorkflow: "WAN_I2V",
    }).success).toBe(false);
    expect(read("packages/shared/src/ai-story-local-generation.ts"))
      .toContain("AI_STORY_CERTIFIED_LOCAL_WORKFLOWS");
  });

  it("18. retains fail-closed MiniMax policy without WAN fallback", () => {
    const materializer =
      read("packages/agents/src/ai-story/local-generation-source-authority.ts");
    expect(materializer).toContain("MINIMAX_H3_NATIVE_DIALOGUE");
    expect(materializer).toContain("LOCAL_WORKFLOW_CERTIFICATION_REQUIRED");
    expect(materializer).not.toContain("WAN_I2V");
  });

  it("19. retains fail-closed policy without Seedance or Runway fallback", () => {
    const materializer =
      read("packages/agents/src/ai-story/local-generation-source-authority.ts");
    expect(materializer).not.toMatch(
      /seedanceAutoFallback|runwayAutoFallback/i,
    );
  });

  it("preflights an unapplied migration without fabricating historical lineage", () => {
    const sql =
      read("packages/db/sql/ai-story-sequential-manual-local-package-v3.sql");
    expect(sql).toContain("DO $preflight$");
    expect(sql).toContain("pg_get_constraintdef");
    expect(sql).toContain("SEQUENTIAL_LOCAL_V3_PREFLIGHT");
    expect(sql).toContain("SEQUENTIAL_LOCAL_V3_UNCLASSIFIABLE_RELEASE_ROWS");
    expect(sql).toContain("REMOTE_PROVIDER_PROVEN");
    expect(sql).toContain("MANUAL_LOCAL_PROVEN");
    expect(sql).toContain("classification = 'UNKNOWN'");
    expect(sql).toContain("ai_story_scene_scheduling_correlations");
    expect(sql).toContain("ai_story_local_generation_packages");
    expect(sql).toContain("authorization.ordered_scene_execution_ids");
    expect(sql).toContain("release.released_by = authorization.authorized_by");
    expect(sql).toContain("'local-generation-package.v1'");
    expect(sql).toContain("'local-generation-package.v2'");
    expect(sql).toContain("'local-generation-package.v3'");
    expect(sql).not.toMatch(
      /UPDATE\s+ai_story_local_generation_packages|DELETE\s+FROM\s+ai_story_local_generation_packages/i,
    );
    expect(sql).not.toContain("ALTER TABLE ai_story_local_media_jobs");
    expect(sql.indexOf("SEQUENTIAL_LOCAL_V3_UNCLASSIFIABLE_RELEASE_ROWS"))
      .toBeLessThan(sql.indexOf("UPDATE ai_story_scene_release_states"));
    expect(sql).not.toMatch(
      /SET\s+org_id\s*=\s*workspace\.org_id,\s*execution_mode/si,
    );
    expect(sql).not.toMatch(
      /SET\s+execution_mode\s*=\s*'REMOTE_PROVIDER'/i,
    );
  });
});

type PreflightPlanEvidence = {
  providerPlanProven: boolean;
  manualPlanProven: boolean;
  predatesManualLocalCode: boolean;
  canonicalRuntimeLedger: boolean;
  completeRuntimeLedger: boolean;
  canonicalInitialActor: boolean;
};

function classifyPreflightPlan(evidence: PreflightPlanEvidence) {
  const historicalRemote =
    evidence.predatesManualLocalCode
    && evidence.canonicalRuntimeLedger
    && evidence.completeRuntimeLedger
    && evidence.canonicalInitialActor;
  const remote = evidence.providerPlanProven || historicalRemote;
  if (evidence.manualPlanProven && !remote) return "MANUAL_LOCAL_PROVEN";
  if (!evidence.manualPlanProven && remote) return "REMOTE_PROVIDER_PROVEN";
  return "UNKNOWN";
}

describe("Sequential Manual Local V3 proof-based release preflight", () => {
  const none: PreflightPlanEvidence = {
    providerPlanProven: false,
    manualPlanProven: false,
    predatesManualLocalCode: false,
    canonicalRuntimeLedger: false,
    completeRuntimeLedger: false,
    canonicalInitialActor: false,
  };

  it("keeps a shape-only remote-looking row UNKNOWN", () => {
    expect(classifyPreflightPlan(none)).toBe("UNKNOWN");
  });

  it.each([
    ["initial Unit", "RELEASED", 1],
    ["released successor", "RELEASED", 2],
    ["waiting successor", "AUTHORIZED_NOT_RELEASED", 2],
  ])("classifies a proven Remote %s independently of row shape", (_label) => {
    expect(classifyPreflightPlan({ ...none, providerPlanProven: true }))
      .toBe("REMOTE_PROVIDER_PROVEN");
  });

  it("accepts a complete pre-Manual-Local canonical runtime ledger", () => {
    expect(classifyPreflightPlan({
      ...none,
      predatesManualLocalCode: true,
      canonicalRuntimeLedger: true,
      completeRuntimeLedger: true,
      canonicalInitialActor: true,
    })).toBe("REMOTE_PROVIDER_PROVEN");
  });

  it("does not classify a partial historical ledger as Remote", () => {
    expect(classifyPreflightPlan({
      ...none,
      predatesManualLocalCode: true,
      canonicalRuntimeLedger: true,
      canonicalInitialActor: true,
    })).toBe("UNKNOWN");
  });

  it("classifies Manual Local proof without defaulting it to Remote", () => {
    expect(classifyPreflightPlan({ ...none, manualPlanProven: true }))
      .toBe("MANUAL_LOCAL_PROVEN");
  });

  it("keeps conflicting Remote and Manual proof UNKNOWN", () => {
    expect(classifyPreflightPlan({
      ...none,
      providerPlanProven: true,
      manualPlanProven: true,
    })).toBe("UNKNOWN");
  });

  it("keeps UNKNOWN blocking before ownership or mode backfill", () => {
    const sql =
      read("packages/db/sql/ai-story-sequential-manual-local-package-v3.sql");
    const guard = sql.indexOf("IF unknown_release_rows <> 0");
    const ownership = sql.indexOf("-- Ownership is independently");
    const mode = sql.indexOf("-- Mode is filled only");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(ownership);
    expect(ownership).toBeLessThan(mode);
  });

  it("leaves historical package rows and migration application untouched", () => {
    const sql =
      read("packages/db/sql/ai-story-sequential-manual-local-package-v3.sql");
    expect(sql).not.toMatch(
      /UPDATE\s+ai_story_local_generation_packages|DELETE\s+FROM\s+ai_story_local_generation_packages/i,
    );
    expect(sql).toContain("PHASE 1 ONLY: write/review this migration; DO NOT APPLY");
  });
});
