import { describe, expect, it } from "vitest";
import {
  AI_STORY_POST_GENERATION_QC_CONTRACT_VERSION,
  AI_STORY_POST_QC_DIMENSIONS,
  AI_STORY_POST_QC_POLICY_VERSION,
  AI_STORY_VISUAL_EVIDENCE_CONTRACT_VERSION,
  AiStoryPostGenerationQcInputPackageSchema,
  POST_QC_AUTO_RELEASE,
  POST_QC_AUTO_RETRY,
  POST_QC_CREATIVE_AUTHORITY,
  type AiStoryPostGenerationQcInputPackage,
  type AiStoryPostQcObservation,
  type AiStoryPostQcRequirement,
} from "../packages/shared/src/ai-story-post-generation-qc";
import {
  AiStoryPostGenerationQcService,
  FakeAiStoryVisualEvidenceProvider,
  InMemoryAiStoryPostGenerationQcRepository,
  POST_QC_DEFAULT_REPAIR_OWNER_SCRIPT,
  POST_QC_PERSISTS_CHAIN_OF_THOUGHT,
  POST_QC_SUBJECTIVE_TASTE_HARD_REJECT,
  buildAiStoryPostQcHumanReviewEvidence,
  buildAiStoryPostGenerationQcInputPackage,
  buildAiStoryPostGenerationQcInputFromCompiledAuthority,
  isAiStoryPostQcCurrentForMedia,
  postQcAllowsHumanApproval,
} from "../packages/agents/src/ai-story/post-generation-qc-service";

const ids = Array.from({ length: 40 }, (_, i) => `${String(i + 1).padStart(8, "0")}-0000-4000-8000-000000000000`);
const hash = (char: string) => `sha256:${char.repeat(64)}`;
let observationIndex = 20;

function requirement(overrides: Partial<AiStoryPostQcRequirement> = {}): AiStoryPostQcRequirement {
  return {
    requirementId: "scene-purpose",
    dimension: "SCENE_FIDELITY",
    summary: "The generated media communicates the required Scene purpose.",
    required: true,
    waiverPolicy: "WAIVABLE_BY_HUMAN",
    sourceOwner: "SCENE",
    visuallyObservable: true,
    ...overrides,
  };
}

function input(requirements: AiStoryPostQcRequirement[], mode: "TEXT_TO_VIDEO" | "FIRST_FRAME_IMAGE_TO_VIDEO" = "TEXT_TO_VIDEO"): AiStoryPostGenerationQcInputPackage {
  return {
    postQcInputId: ids[0]!, contractVersion: AI_STORY_POST_GENERATION_QC_CONTRACT_VERSION,
    policyVersion: AI_STORY_POST_QC_POLICY_VERSION, orgId: ids[1]!, workspaceId: ids[2]!, campaignId: ids[3]!,
    storyId: ids[4]!, storyVersionId: ids[5]!, planningLineageSource: "FROZEN_SCRIPT_DIRECTOR",
    scriptVersionId: ids[6]!, handoffId: ids[7]!, sceneExecutionId: ids[8]!,
    sceneId: "scene-1", sceneVersion: 1, sceneFingerprint: hash("a"), sceneExecutionFingerprint: hash("b"),
    providerAttemptId: "attempt-1", generationMode: mode, privateMediaAssetId: ids[9]!, privateMediaContentHash: hash("c"),
    compiledRequestId: ids[10]!, compiledRequestFingerprint: hash("d"), semanticPlanFingerprint: hash("e"),
    preGenerationQcEvaluationId: ids[11]!, preGenerationQcFingerprint: hash("f"), handoffFingerprint: hash("1"),
    directorFingerprint: hash("2"), motionFingerprint: hash("3"), shotRecipeFingerprint: hash("4"),
    castSnapshotFingerprint: hash("5"), locationSnapshotFingerprint: hash("6"), productSnapshotFingerprint: hash("7"),
    entryState: ["A holds Product"], scriptActions: ["A gives Product to B"], requiredExitState: ["B holds Product"],
    mustKeep: ["canonical Product shape"], mustAvoid: ["unwanted text"], newAudienceInformation: ["Product benefit"],
    requiredEvidence: ["Product usage"], requirements, providerMetadata: { provider: "seedance", model: "dreamina-seedance-2-0-260128" },
    media: { durableObjectReference: `${ids[2]}/ai-story/result.mp4`, mediaType: "video/mp4", byteSize: 4096, durationMs: 5000, width: 1280, height: 720, readable: true, decodable: true },
    createdAt: "2026-08-30T00:00:00.000Z",
  };
}

function observation(requirementId: string, signal: AiStoryPostQcObservation["observableSignal"], overrides: Partial<AiStoryPostQcObservation> = {}): AiStoryPostQcObservation {
  observationIndex += 1;
  return {
    observationId: `${String(observationIndex).padStart(8, "0")}-0000-4000-8000-000000000000`, evidenceVersion: AI_STORY_VISUAL_EVIDENCE_CONTRACT_VERSION,
    requirementId, source: "AI_VISUAL_EVIDENCE", summary: `${requirementId} ${signal.toLowerCase()}`,
    observableSignal: signal, confidence: { level: "HIGH", score: 0.96, evidenceQuality: "STRONG" },
    timeRangeMs: { start: 0, end: 5000 }, subjects: ["subject"], artifactSeverity: null, subjectiveTasteOnly: false,
    ...overrides,
  };
}

async function evaluate(requirements: AiStoryPostQcRequirement[], observations: AiStoryPostQcObservation[], mode: "TEXT_TO_VIDEO" | "FIRST_FRAME_IMAGE_TO_VIDEO" = "TEXT_TO_VIDEO") {
  const repository = new InMemoryAiStoryPostGenerationQcRepository();
  return new AiStoryPostGenerationQcService({ repository, evidenceProvider: new FakeAiStoryVisualEvidenceProvider(observations), now: () => "2026-08-30T01:00:00.000Z" }).evaluate(input(requirements, mode));
}

describe("AI Story canonical Post-Generation QC", () => {
  it("certifies all required dimensions and preserves authority boundaries", () => {
    expect(AI_STORY_POST_QC_DIMENSIONS).toEqual(expect.arrayContaining(["SCENE_FIDELITY", "PRODUCT_FIDELITY", "CHARACTER_FIDELITY", "LOCATION_FIDELITY", "ACTION_COMPLETION", "END_STATE", "CONTINUITY", "DIRECTOR_EXECUTION", "MOTION_EXECUTION", "REQUIRED_EVIDENCE", "MUST_KEEP", "MUST_AVOID", "VISUAL_ARTIFACTS", "TEXT_CONTAMINATION", "OUTPUT_INTEGRITY"]));
    expect(POST_QC_CREATIVE_AUTHORITY).toBe(false);
    expect(POST_QC_AUTO_RETRY).toBe(false);
    expect(POST_QC_AUTO_RELEASE).toBe(false);
    expect(POST_QC_PERSISTS_CHAIN_OF_THOUGHT).toBe(false);
    expect(POST_QC_DEFAULT_REPAIR_OWNER_SCRIPT).toBe(false);
  });

  it("fails closed before evaluation when Attempt and execution-package lineage differ", () => {
    expect(() => buildAiStoryPostGenerationQcInputPackage({
      package: { sceneExecutionPackageId: "package-a" } as never,
      compiledRequest: { sceneExecutionPackageId: "package-b" } as never,
      attempt: {} as never,
      privateMedia: {} as never,
    })).toThrow("POST_QC_ATTEMPT_LINEAGE_MISMATCH");
  });

  it("builds the V1 runtime Post-QC input from persisted compilation authority", () => {
    const compiled = {
      compiledRequestId: ids[10]!, orgId: ids[1]!, workspaceId: ids[2]!, campaignId: ids[3]!,
      storyId: ids[4]!, storyVersionId: ids[5]!, sceneExecutionId: ids[8]!,
      generationMode: "TEXT_TO_VIDEO", providerId: "seedance", modelId: "dreamina-seedance-2-0-260128",
      requestFingerprint: hash("d"), sceneFingerprint: hash("a"), packageFingerprint: hash("b"),
      semanticPlanFingerprint: hash("e"), qcEvaluationId: ids[11]!, qcFingerprint: hash("f"),
      directorFingerprint: hash("2"), motionFingerprint: hash("3"), castSnapshotFingerprint: hash("5"),
      locationSnapshotFingerprint: hash("6"), productSnapshotFingerprint: hash("7"),
      semanticPlan: { sections: [{ section: "MUST_AVOID", facts: ["unwanted text"] }] },
    } as never;
    const built = buildAiStoryPostGenerationQcInputFromCompiledAuthority({
      intent: { identity: { sceneExecutionId: ids[8]!, sceneId: "scene-1" }, compilationHash: hash("a") } as never,
      instructions: {
        sceneId: "scene-1", purpose: "Atmospheric spring transition", continuityNotes: "Spring light grows.",
        shots: [{ shotId: "shot-1", information: "Petals move through warm light." }],
        productIdentityConstraints: [],
      } as never,
      preGenerationAuthority: {
        planningLineageSource: "FROZEN_SCRIPT_DIRECTOR",
        qcEvaluationId: ids[11]!, qcFingerprint: hash("f"),
        scriptVersionId: ids[6]!, handoffId: ids[7]!, productGrounded: false,
        handoffFingerprint: hash("1"),
        shotRecipeFingerprint: null,
      } as never,
      sceneVersion: 2, compiledRequest: compiled,
      attempt: {
        providerAttemptId: "attempt-1", compiledRequestId: ids[10]!, requestFingerprint: hash("d"),
        sceneExecutionId: ids[8]!, orgId: ids[1]!, workspaceId: ids[2]!, campaignId: ids[3]!,
        storyId: ids[4]!, storyVersionId: ids[5]!, generationMode: "TEXT_TO_VIDEO",
        providerId: "seedance", modelId: "dreamina-seedance-2-0-260128", mediaAssetId: ids[9]!,
      },
      privateMedia: {
        mediaAssetId: ids[9]!, contentHash: hash("c"), durableObjectReference: `${ids[2]}/result.mp4`,
        byteSize: 4096, durationMs: 5000, width: 480, height: 854, readable: true, decodable: true,
      }, createdAt: "2026-09-01T00:00:00.000Z",
    });
    expect(built).toMatchObject({
      sceneExecutionId: ids[8], providerAttemptId: "attempt-1", generationMode: "TEXT_TO_VIDEO",
      privateMediaAssetId: ids[9], sceneVersion: 2,
    });
    expect(built.requirements.map((item) => item.requirementId)).toEqual(expect.arrayContaining([
      "scene-purpose", "action:shot-1", "output-integrity", "visual-artifact-integrity",
    ]));
  });

  it("represents legacy compiled V1 lineage explicitly without fabricating Script or Handoff authority", () => {
    const legacy = AiStoryPostGenerationQcInputPackageSchema.parse({
      ...input([requirement()]),
      planningLineageSource: "LEGACY_COMPILED_V1",
      scriptVersionId: null,
      handoffId: null,
      handoffFingerprint: null,
    });
    expect(legacy).toMatchObject({
      planningLineageSource: "LEGACY_COMPILED_V1",
      scriptVersionId: null,
      handoffId: null,
      handoffFingerprint: null,
      preGenerationQcEvaluationId: ids[11],
      preGenerationQcFingerprint: hash("f"),
    });
    expect(() => AiStoryPostGenerationQcInputPackageSchema.parse({
      ...legacy,
      scriptVersionId: ids[6],
    })).toThrow(/must not fabricate/i);
  });

  it("fails closed when V1 compiled authority and Attempt binding diverge", () => {
    expect(() => buildAiStoryPostGenerationQcInputFromCompiledAuthority({
      intent: { identity: { sceneExecutionId: ids[8]!, sceneId: "scene-1" }, compilationHash: hash("a") } as never,
      instructions: { sceneId: "scene-1" } as never,
      preGenerationAuthority: { qcEvaluationId: ids[11]!, qcFingerprint: hash("f") } as never,
      sceneVersion: 1,
      compiledRequest: { sceneExecutionId: ids[8]!, compiledRequestId: ids[10]!, requestFingerprint: hash("d"), qcEvaluationId: ids[11]!, qcFingerprint: hash("f"), sceneFingerprint: hash("a") } as never,
      attempt: { compiledRequestId: ids[12]! } as never,
      privateMedia: {} as never,
    })).toThrow("POST_QC_COMPILED_AUTHORITY_LINEAGE_MISMATCH");
  });

  it("separates observable evidence from interpretation and passes satisfied facts", async () => {
    const req = requirement();
    const result = await evaluate([req], [observation(req.requirementId, "SATISFIED")]);
    expect(result.evaluation.aggregateStatus).toBe("POST_QC_PASS");
    expect(result.evaluation.observations[0]?.summary).not.toBe(result.evaluation.findings[0]?.reason);
    expect(result.evaluation.autoApproved).toBe(false);
  });

  it("supports WARN and never hard-rejects subjective beauty", async () => {
    const req = requirement({ required: false, summary: "Camera could feel more exciting." });
    const result = await evaluate([req], [observation(req.requirementId, "VIOLATED", { subjectiveTasteOnly: true })]);
    expect(result.evaluation.aggregateStatus).toBe("POST_QC_WARN");
    expect(POST_QC_SUBJECTIVE_TASTE_HARD_REJECT).toBe(false);
  });

  it("warns on explicitly minor generative variation instead of hard rejection", async () => {
    const req = requirement({ requirementId: "minor-product-variation", dimension: "PRODUCT_FIDELITY", summary: "Minor non-material Product variation." });
    const result = await evaluate([req], [observation(req.requirementId, "VIOLATED", { artifactSeverity: "MINOR" })]);
    expect(result.evaluation.aggregateStatus).toBe("POST_QC_WARN");
  });

  it("routes required unverified facts to Human confirmation instead of auto-pass", async () => {
    const result = await evaluate([requirement()], []);
    expect(result.evaluation.aggregateStatus).toBe("POST_QC_REQUIRES_HUMAN_CONFIRMATION");
    expect(result.evaluation.findings[0]?.result).toBe("UNVERIFIED");
  });

  it.each([
    ["PRODUCT_FIDELITY", "PRODUCT_IDENTITY_DRIFT"], ["CHARACTER_FIDELITY", "CHARACTER_IDENTITY_DRIFT"],
    ["LOCATION_FIDELITY", "LOCATION_IDENTITY_DRIFT"], ["ACTION_COMPLETION", "ACTION_INCOMPLETE"],
    ["END_STATE", "END_STATE_MISSING"], ["REQUIRED_EVIDENCE", "REQUIRED_EVIDENCE_MISSING"],
    ["MUST_KEEP", "MUST_KEEP_VIOLATION"], ["MUST_AVOID", "MUST_AVOID_VIOLATION"],
    ["TEXT_CONTAMINATION", "TEXT_CONTAMINATION"], ["VISUAL_ARTIFACTS", "VISUAL_QUALITY_FAILURE"],
  ] as const)("rejects strong required %s violations with repair classification", async (dimension, failure) => {
    const req = requirement({ requirementId: dimension.toLowerCase(), dimension, summary: `${dimension} canonical requirement` });
    const result = await evaluate([req], [observation(req.requirementId, "VIOLATED", dimension === "VISUAL_ARTIFACTS" ? { artifactSeverity: "SEVERE" } : {})]);
    expect(result.evaluation.aggregateStatus).toBe("POST_QC_REJECT");
    expect(result.evaluation.findings[0]).toMatchObject({ failureClass: failure, repairOwner: "PROVIDER_EXECUTION", sameInputRetryCandidate: true });
  });

  it("separates physical causality execution failure from a correct upstream plan", async () => {
    const req = requirement({ requirementId: "causality", dimension: "MOTION_EXECUTION", summary: "Physical causal handoff must remain observable.", sourceOwner: "MOTION" });
    const result = await evaluate([req], [observation(req.requirementId, "VIOLATED", { summary: "Product teleports between characters without contact." })]);
    expect(result.evaluation.findings[0]).toMatchObject({ failureClass: "PHYSICAL_CAUSALITY_FAILURE", repairOwner: "PROVIDER_EXECUTION" });
  });

  it("treats semantically close optional camera movement as acceptable warning", async () => {
    const req = requirement({ requirementId: "camera", dimension: "DIRECTOR_EXECUTION", summary: "Optional slow push-in", required: false, sourceOwner: "DIRECTOR" });
    const result = await evaluate([req], [observation(req.requirementId, "VIOLATED", { confidence: { level: "MEDIUM", score: 0.7, evidenceQuality: "ADEQUATE" } })]);
    expect(result.evaluation.aggregateStatus).toBe("POST_QC_WARN");
  });

  it("routes proven adapter camera translation defects to Provider Adapter", async () => {
    const req = requirement({ requirementId: "camera-critical", dimension: "DIRECTOR_EXECUTION", summary: "Required camera reveal", sourceOwner: "PROVIDER_ADAPTER" });
    const result = await evaluate([req], [observation(req.requirementId, "VIOLATED")]);
    expect(result.evaluation.findings[0]?.repairOwner).toBe("PROVIDER_ADAPTER");
  });

  it("performs deterministic private-media output integrity checks", async () => {
    const req = requirement({ requirementId: "output", dimension: "OUTPUT_INTEGRITY", summary: "Video must be readable and structurally usable.", waiverPolicy: "NON_WAIVABLE_INTEGRITY", sourceOwner: "POST_PROCESSING" });
    const result = await evaluate([req], []);
    expect(result.evaluation.findings[0]?.result).toBe("PASS");
    expect(result.evaluation.observations[0]?.source).toBe("DETERMINISTIC_MEDIA_CHECK");
  });

  it("supports T2V without false reference failure and mode-aware I2V evidence", async () => {
    const t2vReq = requirement({ requirementId: "t2v-action", dimension: "ACTION_COMPLETION" });
    const t2v = await evaluate([t2vReq], [observation(t2vReq.requirementId, "SATISFIED")], "TEXT_TO_VIDEO");
    expect(t2v.evaluation.aggregateStatus).toBe("POST_QC_PASS");
    const i2vReq = requirement({ requirementId: "reference-fidelity", dimension: "PRODUCT_FIDELITY", summary: "Required first-frame reference fidelity" });
    const i2v = await evaluate([i2vReq], [observation(i2vReq.requirementId, "SATISFIED")], "FIRST_FRAME_IMAGE_TO_VIDEO");
    expect(i2v.evaluation.generationMode).toBe("FIRST_FRAME_IMAGE_TO_VIDEO");
  });

  it("handles supporting, ephemeral, multi-cast and recurring locations from requirements rather than role taxonomies", async () => {
    const requirements = [
      requirement({ requirementId: "supporting", dimension: "CHARACTER_FIDELITY", summary: "Story-local supporting identity remains consistent." }),
      requirement({ requirementId: "ephemeral", dimension: "CHARACTER_FIDELITY", summary: "Scene-local actor satisfies this Scene only." }),
      requirement({ requirementId: "location", dimension: "LOCATION_FIDELITY", summary: "Recurring location remains materially consistent despite camera/time variation." }),
    ];
    const result = await evaluate(requirements, requirements.map((req) => observation(req.requirementId, "SATISFIED")));
    expect(result.evaluation.aggregateStatus).toBe("POST_QC_PASS");
  });

  it("generalizes across unknown Product, Character role, Location, Action and genre", async () => {
    const requirements = ["unknown-product", "synthetic-cast-role", "unknown-location-type", "novel-action-verb", "unknown-genre-purpose"].map((id, index) => requirement({ requirementId: id, dimension: AI_STORY_POST_QC_DIMENSIONS[index]!, summary: `Open semantic ${id}` }));
    const result = await evaluate(requirements, requirements.map((req) => observation(req.requirementId, "SATISFIED")));
    expect(result.evaluation.aggregateStatus).toBe("POST_QC_PASS");
  });

  it("safely degrades visual evidence engine failure to Human confirmation", async () => {
    const service = new AiStoryPostGenerationQcService({ repository: new InMemoryAiStoryPostGenerationQcRepository(), evidenceProvider: new FakeAiStoryVisualEvidenceProvider(new Error("vision unavailable")) });
    const result = await service.evaluate(input([requirement()]));
    expect(result.evaluation.evidenceUnavailable).toBe(true);
    expect(result.evaluation.aggregateStatus).toBe("POST_QC_REQUIRES_HUMAN_CONFIRMATION");
  });

  it("is idempotent, concurrency-convergent, immutable and replay-safe", async () => {
    const req = requirement(); const repository = new InMemoryAiStoryPostGenerationQcRepository();
    const service = new AiStoryPostGenerationQcService({ repository, evidenceProvider: new FakeAiStoryVisualEvidenceProvider([observation(req.requirementId, "SATISFIED")]), now: () => "2026-08-30T01:00:00.000Z" });
    const [a, b] = await Promise.all([service.evaluate(input([req])), service.evaluate(input([req]))]);
    expect(a.evaluation.evaluationFingerprint).toBe(b.evaluation.evaluationFingerprint);
    expect([a.replayed, b.replayed]).toContain(true);
    expect(isAiStoryPostQcCurrentForMedia(a.evaluation, ids[9]!, hash("c"))).toBe(true);
    expect(isAiStoryPostQcCurrentForMedia(a.evaluation, ids[9]!, hash("8"))).toBe(false);
  });

  it("creates a new immutable identity for explicit re-evaluation", async () => {
    const req = requirement(); const repository = new InMemoryAiStoryPostGenerationQcRepository();
    const service = new AiStoryPostGenerationQcService({ repository, evidenceProvider: new FakeAiStoryVisualEvidenceProvider([observation(req.requirementId, "SATISFIED")]) });
    const first = await service.evaluate(input([req]), 1); const second = await service.evaluate(input([req]), 2);
    expect(first.evaluation.postQcEvaluationId).not.toBe(second.evaluation.postQcEvaluationId);
  });

  it("binds safe evidence to Human Review and makes hard waiver policy explicit", async () => {
    const req = requirement({ waiverPolicy: "NON_WAIVABLE_INTEGRITY" });
    const result = await evaluate([req], [observation(req.requirementId, "VIOLATED")]);
    const review = buildAiStoryPostQcHumanReviewEvidence({ evaluation: result.evaluation, sceneSummary: "A gives Product to B." });
    expect(review).toMatchObject({ humanDecisionRequired: true, warningsMayBeAccepted: true, hardFailureWaiverPolicy: "EXPLICIT_NON_WAIVABLE_INTEGRITY_DENIAL" });
    expect(postQcAllowsHumanApproval(result.evaluation)).toBe(false);
  });

  it("retrospectively rejects weak duplicate evidence and accepts differentiated Product detail", async () => {
    const req = requirement({ requirementId: "r4-differentiation", dimension: "SCENE_FIDELITY", summary: "Scene supplies differentiated Product evidence." });
    const weak = await evaluate([req], [observation(req.requirementId, "VIOLATED", { summary: "Hero framing repeats with no new evidence." })]);
    expect(weak.evaluation.aggregateStatus).toBe("POST_QC_REJECT");
    const valid = await evaluate([req], [observation(req.requirementId, "SATISFIED", { summary: "New material detail is visibly revealed." })]);
    expect(valid.evaluation.aggregateStatus).toBe("POST_QC_PASS");
  });
});
