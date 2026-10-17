import { createHash } from "node:crypto";
import {
  LOCAL_GPU_V2_FIRST_FRAME_AUTHORITIES,
  LocalGpuContractError,
  buildLocalGpuDesktopSubmitV2,
  canonicalLocalGpuSigningPayload,
  localGpuCanonicalCreativeJobForV2Body,
  localGpuCreativeBindingForV2Body,
  type LocalGpuSignedFields,
  type LocalGpuV2FirstFrameAuthorityType,
} from "@ceo-agent/shared/server";
import { signLocalGpuRequest } from "../../packages/agents/src/ai-story/local-gpu-signing";

export const LOCAL_GPU_V2_GOLDEN_VECTOR_PATH = "tests/fixtures/local-gpu-cloud-v2-golden-vector.json";

const id = (prefix: string, n: number) => `${prefix}${String(n).padStart(8 - prefix.length, "0")}-0000-4000-8000-000000000000`;
const hash = (mark: string) => `sha256:${mark.repeat(64)}`;
const secret = "contract-v2-golden-test-secret";
const now = Date.parse("2026-10-18T00:00:00.000Z");
const workspaceId = id("", 3);
const actorId = id("", 16);
const productId = id("", 22);
const characterId = id("", 11);
const productUrl = "https://assets.invalid/v2-golden/product.png";
const characterUrl = "https://assets.invalid/v2-golden/character.png";
const frameUrl = "https://assets.invalid/v2-golden/predecessor-frame.png";
const upload = (n: number) => ({ environment: "staging", method: "PUT", url: `https://uploads.invalid/v2-golden/${n}.mp4`, assetId: id("a", n) });
const productRef = { approval: "APPROVED" as const, role: "PRODUCT" as const, subjectId: productId, variantId: "matte-black", assetUrl: productUrl, contentHash: hash("d") };
const characterRef = { approval: "APPROVED" as const, role: "CHARACTER" as const, subjectId: characterId, variantId: null, assetUrl: characterUrl, contentHash: hash("c") };
const allAuthorities = [...LOCAL_GPU_V2_FIRST_FRAME_AUTHORITIES];

type BuilderInput = Parameters<typeof buildLocalGpuDesktopSubmitV2>[0];

function base(n: number): Omit<BuilderInput, "creative" | "references" | "audioPolicy"> {
  return {
    environment: "staging",
    jobId: id("9", n),
    sceneExecutionId: id("4", n),
    workspaceId,
    workflow: "MINIMAX_H3_R2V",
    prompt: `Golden V2 scene ${n}. The authorized subject stays centered.`,
    plannedDurationMs: 5000 + n * 1000,
    upload: upload(n),
  };
}

const cases: { name: string; covers: string[]; input: BuilderInput }[] = [
  {
    name: "product-only-initial-material-first-frame",
    covers: ["PRODUCT_REFERENCE", "INITIAL_MATERIAL_REFERENCE", "FIRST_FRAME_SHARES_PRODUCT_IMAGE", "SILENT_OUTPUT"],
    input: {
      ...base(1),
      audioPolicy: "SILENT_OUTPUT",
      productOnlyScene: true,
      creative: { characters: [], products: [{ subjectId: productId, variantId: "matte-black" }] },
      references: [productRef],
      firstFrame: { sourceAssetId: id("b", 1), authoritySourceAssetId: id("b", 1), contentHash: productRef.contentHash, authorityContentHash: productRef.contentHash, assetUrl: productUrl },
      firstFrameAuthorities: allAuthorities,
    },
  },
  {
    name: "character-only-no-first-frame",
    covers: ["CHARACTER_REFERENCE", "CHARACTER_DNA_FINGERPRINT", "NO_FIRST_FRAME", "NO_DIALOGUE_WITH_AMBIENT_AUDIO"],
    input: {
      ...base(2),
      audioPolicy: "NO_DIALOGUE_WITH_AMBIENT_AUDIO",
      creative: { characters: [{ subjectId: characterId, dnaFingerprint: hash("a") }], products: [] },
      references: [characterRef],
    },
  },
  {
    name: "mixed-predecessor-continuity-first-frame",
    covers: ["PRODUCT_REFERENCE", "CHARACTER_REFERENCE", "REFERENCE_ORDER_CHARACTER_THEN_PRODUCT", "PREDECESSOR_CONTINUITY", "PRESERVE"],
    input: {
      ...base(3),
      audioPolicy: "PRESERVE",
      creative: { characters: [{ subjectId: characterId, dnaFingerprint: hash("a") }], products: [{ subjectId: productId, variantId: "matte-black" }] },
      references: [productRef, characterRef],
      firstFrame: {
        sourceAssetId: id("b", 3), authoritySourceAssetId: id("b", 3), contentHash: hash("e"), authorityContentHash: hash("e"), assetUrl: frameUrl,
        lineage: { sourceType: "PREDECESSOR_CONTINUITY", sourceSceneId: id("4", 2), predecessorGenerationResultId: id("c", 2), storyVersion: id("6", 1), executionPlanId: id("5", 1) },
      },
      firstFrameAuthorities: ["PREDECESSOR_CONTINUITY"],
    },
  },
];

const refusals: { name: string; expectedCloudError: string; input: BuilderInput }[] = [
  {
    name: "initial-material-on-desktop-without-capability",
    expectedCloudError: "LOCAL_GPU_FIRST_FRAME_AUTHORITY_UNSUPPORTED",
    input: { ...cases[0].input, firstFrameAuthorities: ["PREDECESSOR_CONTINUITY"] satisfies LocalGpuV2FirstFrameAuthorityType[] },
  },
  {
    name: "first-frame-without-lineage-or-approved-reference",
    expectedCloudError: "LOCAL_GPU_CONTINUITY_AUTHORITY_REQUIRED",
    input: { ...cases[0].input, firstFrame: { ...cases[0].input.firstFrame!, contentHash: hash("f"), authorityContentHash: hash("f"), assetUrl: frameUrl } },
  },
  {
    name: "product-without-variant",
    expectedCloudError: "LOCAL_GPU_PRODUCT_VARIANT_REQUIRED",
    input: {
      ...cases[1].input,
      creative: { characters: [], products: [{ subjectId: productId, variantId: null }] },
      references: [{ ...productRef, variantId: null }],
    },
  },
];

function refusalCode(input: BuilderInput): string {
  try {
    buildLocalGpuDesktopSubmitV2(input);
  } catch (error) {
    if (error instanceof LocalGpuContractError) return error.message;
    throw error;
  }
  throw new Error("expected Cloud to refuse the V2 input");
}

/** Builds the cross-repository V2 vector from the real Cloud submit builder and signer. */
export function buildLocalGpuV2GoldenVector() {
  return {
    kind: "embersoul.local-gpu.cloud-v2.golden-vector",
    version: 1,
    classification: "TEST_ONLY_SYNTHETIC",
    contractVersion: 2,
    testOnlySecret: { classification: "TEST_ONLY", utf8: secret },
    syntheticAuthorization: { now: new Date(now).toISOString(), authority: "SUPERADMIN", action: "submit" },
    cases: cases.map((entry, index) => {
      const built = buildLocalGpuDesktopSubmitV2(entry.input);
      const canonical = JSON.stringify(localGpuCanonicalCreativeJobForV2Body(built.body));
      const creativeBinding = localGpuCreativeBindingForV2Body(built.body);
      if (createHash("sha256").update(canonical, "utf8").digest("hex") !== creativeBinding) throw new Error("canonical bytes drifted");
      const signedClaims: LocalGpuSignedFields = {
        v: 1,
        environment: "staging",
        action: "submit",
        jobId: built.body.jobId,
        workspaceId,
        actorId,
        authority: "SUPERADMIN",
        workflow: built.body.workflow,
        sceneExecutionId: built.body.sceneExecutionId,
        expiresAt: now + 5 * 60 * 1000,
        nonce: `v2-golden-nonce-${index + 1}`,
        uploadBinding: built.uploadBinding,
        creativeBinding,
      };
      const signed = signLocalGpuRequest(secret, signedClaims);
      return {
        name: entry.name,
        covers: entry.covers,
        firstFrameAuthorities: entry.input.firstFrameAuthorities ?? ["PREDECESSOR_CONTINUITY"],
        body: built.body,
        canonicalCreativeJobUtf8: canonical,
        creativeBinding,
        uploadBinding: built.uploadBinding,
        signedClaims,
        canonicalSigningInput: canonicalLocalGpuSigningPayload(signedClaims),
        token: signed.token,
      };
    }),
    cloudRefusals: refusals.map((entry) => ({ name: entry.name, expectedCloudError: refusalCode(entry.input) === entry.expectedCloudError ? entry.expectedCloudError : refusalCode(entry.input) })),
    legacyShapeRejection: {
      description: "Pre-canonical Cloud V2 shape: bare firstFrame, flat product, empty scene authority.",
      expectedDesktopError: "LOCAL_GPU_CONTINUITY_NOT_APPROVED",
      body: {
        ...JSON.parse(JSON.stringify(buildLocalGpuDesktopSubmitV2(cases[0].input).body)),
        creative: { characters: [], products: [{ subjectId: productId, variantId: "matte-black", modelBound: false }], scene: { sceneExecutionId: id("4", 1) } },
        firstFrame: { sourceAssetId: id("b", 1), contentHash: productRef.contentHash, assetUrl: productUrl },
      },
    },
  };
}
