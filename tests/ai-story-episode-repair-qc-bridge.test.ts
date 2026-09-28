import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AI_STORY_POST_GENERATION_QC_CONTRACT_VERSION,
  AI_STORY_POST_QC_POLICY_VERSION,
  AI_STORY_VIDEO_ASSET_ANALYSIS_VERSION,
  AI_STORY_VIDEO_OBSERVATION_EXTRACTOR_VERSION,
  AI_STORY_VISUAL_EVIDENCE_CONTRACT_VERSION,
  AiStoryVideoModelObservationSchema,
  classifyVisualTextScripts,
  productI2vCharacterReferenceComposition,
  projectVisualTextObservationFromCache,
  type AiStoryPostGenerationQcInputPackage,
  type AiStoryPostQcRequirement,
  type AiStoryVideoAnalysisSnapshotRecord,
  type AiStoryVideoAnalysisSnapshotRepository,
  type AiStoryVisualTextRenderPolicy,
} from "@ceo-agent/shared";
import {
  AiStoryPostGenerationQcService,
  assemblyV2SegmentAudioTreatment,
  ensureAiStoryVideoAssetAnalysis,
  InMemoryAiStoryPostGenerationQcRepository,
  type AiStoryVisualEvidenceProvider,
} from "@ceo-agent/agents";

const id = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const hash = (char: string) => `sha256:${char.repeat(64)}`;

function requirement(): AiStoryPostQcRequirement {
  return {
    requirementId: "scene-purpose",
    dimension: "SCENE_FIDELITY",
    summary: "The generated media communicates the required Scene purpose.",
    required: false,
    waiverPolicy: "WAIVABLE_BY_HUMAN",
    sourceOwner: "SCENE",
    visuallyObservable: false,
  };
}

function postQcInput(postQcInputId: string): AiStoryPostGenerationQcInputPackage {
  return {
    postQcInputId,
    contractVersion: AI_STORY_POST_GENERATION_QC_CONTRACT_VERSION,
    policyVersion: AI_STORY_POST_QC_POLICY_VERSION,
    orgId: id(1),
    workspaceId: id(2),
    campaignId: id(3),
    storyId: id(4),
    storyVersionId: id(5),
    planningLineageSource: "FROZEN_SCRIPT_DIRECTOR",
    scriptVersionId: id(6),
    handoffId: id(7),
    sceneExecutionId: id(8),
    sceneId: "scene-1",
    sceneVersion: 1,
    sceneFingerprint: hash("a"),
    sceneExecutionFingerprint: hash("b"),
    providerAttemptId: "attempt-1",
    generationMode: "TEXT_TO_VIDEO",
    privateMediaAssetId: id(9),
    privateMediaContentHash: hash("c"),
    compiledRequestId: id(10),
    compiledRequestFingerprint: hash("d"),
    semanticPlanFingerprint: hash("e"),
    preGenerationQcEvaluationId: id(11),
    preGenerationQcFingerprint: hash("f"),
    handoffFingerprint: hash("1"),
    directorFingerprint: hash("2"),
    motionFingerprint: hash("3"),
    shotRecipeFingerprint: hash("4"),
    castSnapshotFingerprint: hash("5"),
    locationSnapshotFingerprint: hash("6"),
    productSnapshotFingerprint: hash("7"),
    entryState: ["A holds Product"],
    scriptActions: ["A gives Product to B"],
    requiredExitState: ["B holds Product"],
    mustKeep: ["canonical Product shape"],
    mustAvoid: ["unwanted text"],
    newAudienceInformation: ["Product benefit"],
    requiredEvidence: ["Product usage"],
    requirements: [requirement()],
    providerMetadata: { provider: "seedance", model: "dreamina-seedance-2-0-260128" },
    media: {
      durableObjectReference: `${id(2)}/ai-story/result.mp4`,
      mediaType: "video/mp4",
      byteSize: 4096,
      durationMs: 5000,
      width: 1280,
      height: 720,
      readable: true,
      decodable: true,
    },
    createdAt: "2026-08-30T00:00:00.000Z",
  };
}

class CountingEvidence implements AiStoryVisualEvidenceProvider {
  readonly providerId = "counting-visual-evidence";
  readonly contractVersion = AI_STORY_VISUAL_EVIDENCE_CONTRACT_VERSION;
  calls = 0;
  async analyze() {
    this.calls += 1;
    return [];
  }
}

async function evaluateVisualText(
  text: string,
  renderPolicy: AiStoryVisualTextRenderPolicy,
  readable = true,
) {
  const evidence = new CountingEvidence();
  const result = await new AiStoryPostGenerationQcService({
    repository: new InMemoryAiStoryPostGenerationQcRepository(),
    evidenceProvider: evidence,
    now: () => "2026-09-28T01:00:00.000Z",
  }).evaluate(postQcInput(id(20 + evidence.calls)), undefined, {
    observedTextReadable: readable,
    observedReadableText: readable ? text : null,
    signageIdentityVisible: true,
    renderPolicy,
  });
  return {
    calls: evidence.calls,
    finding: result.evaluation.findings.find((item) => item.requirementId === "visual-text-language"),
  };
}

describe("cached visual text post-generation gate", () => {
  it("keeps a historical observation readable without a second analyzer version", () => {
    const parsed = AiStoryVideoModelObservationSchema.parse({
      framingSummary: "A shop counter.",
      primaryActionSummary: "A person stands at the counter.",
      environmentSummary: "A shop interior.",
      signageIdentityVisible: true,
    });
    expect(AI_STORY_VIDEO_OBSERVATION_EXTRACTOR_VERSION).toBe("ai-story-video-observation-extractor.v4");
    expect(AI_STORY_VIDEO_ASSET_ANALYSIS_VERSION).toBe("ai-story-video-asset-analysis.v1");
    expect(parsed.observedTextReadable).toBeNull();
    expect(parsed.observedReadableText).toBeNull();
    expect(projectVisualTextObservationFromCache({
      observedTextReadable: null,
      observedReadableText: null,
      signageIdentityVisible: true,
      renderPolicy: "PROVIDER_NON_LEGIBLE",
    })).toMatchObject({ readable: false, text: "" });
  });

  it("blocks an unauthorized visual script from the cached observation", async () => {
    expect(classifyVisualTextScripts("สวัสดี").allowed).toBe(false);
    const result = await evaluateVisualText("สวัสดี", "PROVIDER_CONSTRAINED");
    expect(result.calls).toBe(1);
    expect(result.finding?.result).toBe("REJECT");
    expect(result.finding?.reason).toContain("UNAUTHORIZED_VISUAL_TEXT_SCRIPT");
  });

  it("allows Latin, Han, and mixed Latin/Han/Common text", async () => {
    const latin = await evaluateVisualText("Open daily", "PROVIDER_CONSTRAINED");
    const han = await evaluateVisualText("欢迎光临", "PROVIDER_CONSTRAINED");
    const mixed = await evaluateVisualText("RM 12 欢迎", "PROVIDER_CONSTRAINED");
    expect(latin.finding?.result).toBe("PASS");
    expect(han.finding?.result).toBe("PASS");
    expect(mixed.finding?.result).toBe("PASS");
    expect(latin.calls).toBe(1);
    expect(han.calls).toBe(1);
    expect(mixed.calls).toBe(1);
  });

  it("rejects readable critical provider text under PROVIDER_NON_LEGIBLE", async () => {
    const result = await evaluateVisualText("MENU 12", "PROVIDER_NON_LEGIBLE");
    expect(result.finding?.result).toBe("REJECT");
    expect(result.calls).toBe(1);
  });

  it("reuses one cached video observation and does not start a second vision call", async () => {
    let extractions = 0;
    const snapshot = { id: id(30) } as AiStoryVideoAnalysisSnapshotRecord;
    const repository: AiStoryVideoAnalysisSnapshotRepository = {
      async findSucceededSnapshot() { return snapshot; },
      async tryClaim() { throw new Error("claim must not run when a snapshot exists"); },
      async waitForSettlement() { return { snapshot: null, failed: false }; },
      async insertSnapshot(row) { return row; },
      async recordProviderAttempt() {},
      async completeClaim() {},
      async failClaim() {},
    };
    const asset = {
      assetId: id(31),
      orgId: id(1),
      workspaceId: id(2),
      storagePath: `${id(2)}/video.mp4`,
      contentHash: hash("c"),
      mimeType: "video/mp4",
      mediaType: "video",
      durationSec: 5,
      width: 720,
      height: 1280,
      fps: null,
      deletedAt: null,
    };
    const first = await ensureAiStoryVideoAssetAnalysis({
      orgId: asset.orgId,
      workspaceId: asset.workspaceId,
      assetId: asset.assetId,
      contentHash: asset.contentHash,
      findAsset: async () => asset,
      repository,
      prepareVision: async () => { throw new Error("vision preparation must not run"); },
      extractObservation: async () => { extractions += 1; throw new Error("second vision call"); },
    });
    const second = await ensureAiStoryVideoAssetAnalysis({
      orgId: asset.orgId,
      workspaceId: asset.workspaceId,
      assetId: asset.assetId,
      contentHash: asset.contentHash,
      findAsset: async () => asset,
      repository,
      prepareVision: async () => { throw new Error("vision preparation must not run"); },
      extractObservation: async () => { extractions += 1; throw new Error("second vision call"); },
    });
    expect(first.reused).toBe(true);
    expect(second.reused).toBe(true);
    expect(first.providerCalls).toBe(0);
    expect(second.providerCalls).toBe(0);
    expect(extractions).toBe(0);
    const postQc = readFileSync("packages/agents/src/ai-story/post-generation-qc-service.ts", "utf8");
    const orchestrator = readFileSync("apps/worker/src/ai-story-post-generation-qc-orchestrator.ts", "utf8");
    expect(postQc).not.toContain("extractObservation");
    expect(orchestrator).not.toContain("extractObservation");
    expect(orchestrator).toContain("findCachedVideoObservationByContentHash");
  });

  it("keeps product first-frame composition, native audio treatment, and provider-free QC", () => {
    expect(productI2vCharacterReferenceComposition({
      generationMode: "FIRST_FRAME_IMAGE_TO_VIDEO",
      characterConsistencyMode: "SOFT_DESCRIPTION_BASED",
    })).toBe("ALLOW_DESCRIPTION");
    expect(productI2vCharacterReferenceComposition({
      generationMode: "FIRST_FRAME_IMAGE_TO_VIDEO",
      characterConsistencyMode: "DNA_PLUS_SYNTHETIC_ANCHOR",
    })).toBe("PRODUCT_I2V_CHARACTER_REFERENCE_COMPOSITION_BLOCKER");
    expect(assemblyV2SegmentAudioTreatment({ preserveAudio: true, sourceHasAudio: true })).toBe("PRESERVE_SOURCE_AUDIO");
    expect(assemblyV2SegmentAudioTreatment({ preserveAudio: true, sourceHasAudio: false })).toBe("INSERT_SILENCE");
    const loader = readFileSync("packages/db/src/queries/ai-story-episode-repair-qc.ts", "utf8");
    expect(loader.toLowerCase()).not.toContain("seedance");
  });
});
