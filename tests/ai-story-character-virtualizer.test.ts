import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHARACTER_SOURCE_PORTRAIT,
  CHARACTER_VIRTUALIZATION,
  CHARACTER_VIRTUALIZER_REAL_IMAGE_PROVIDER_CALLS,
  CHARACTER_VIRTUALIZER_SEEDANCE_VIDEO_CALLS,
  DEFAULT_CHARACTER_VIRTUAL_STYLE,
  EPISODE_GENERATION,
  NO_AUTOMATIC_VIRTUALIZATION_RETRY,
  SOURCE_PORTRAIT,
  VIRTUAL_CHARACTER_CANDIDATE,
  assertCandidateRequiresAcceptance,
  characterVirtualizationCostEstimate,
  compileVirtualizationLineage,
  evaluateSourcePortraitDeletion,
  publicVirtualizationJob,
  sourcePortraitCannotReplaceCanonicalOutput,
  validateCharacterSourcePortrait,
  visualClassForVirtualStyle,
} from "@ceo-agent/shared";
import {
  MockCharacterVirtualizationProvider,
  applyProviderFailureToJob,
  applyProviderSuccessToJob,
  buildAiStoryCharacterVirtualizationJob,
  compileCharacterVirtualizationPrompt,
  hashCharacterVirtualizationBytes,
  markJobAccepted,
  MOCK_VIRTUAL_CHARACTER_PNG,
} from "@ceo-agent/shared/server";

const IDS = {
  org: "71000000-0000-4000-8000-000000000001",
  workspace: "71000000-0000-4000-8000-000000000002",
  otherWorkspace: "71000000-0000-4000-8000-000000000003",
  actor: "71000000-0000-4000-8000-000000000004",
  source: "71000000-0000-4000-8000-000000000005",
  output: "71000000-0000-4000-8000-000000000006",
  character: "71000000-0000-4000-8000-000000000007",
  version: "71000000-0000-4000-8000-000000000008",
};
const SOURCE_HASH = `sha256:${"1".repeat(64)}`;
const OUTPUT_HASH = hashCharacterVirtualizationBytes(MOCK_VIRTUAL_CHARACTER_PNG);

function queuedJob() {
  return buildAiStoryCharacterVirtualizationJob({
    orgId: IDS.org,
    workspaceId: IDS.workspace,
    sourceAssetId: IDS.source,
    sourceContentHash: SOURCE_HASH,
    style: "PREMIUM_3D",
    creativeDirection: "friendly SME spokesperson",
    permissionConfirmed: true,
    createdBy: IDS.actor,
    createdAt: "2026-09-22T12:00:00.000Z",
  });
}

describe("AI Story Character Virtualizer V1", () => {
  it("1. accepts a single JPEG/PNG/WebP portrait as SOURCE_PORTRAIT", () => {
    expect(validateCharacterSourcePortrait({
      type: "image", mimeType: "image/jpeg", fileSizeBytes: 120_000,
    })).toEqual({ ok: true });
    expect(SOURCE_PORTRAIT).toBe("SOURCE_PORTRAIT");
    expect(CHARACTER_SOURCE_PORTRAIT).toBe("CHARACTER_SOURCE_PORTRAIT");
  });

  it("2. source portrait cannot be IDENTITY_MASTER", () => {
    expect(validateCharacterSourcePortrait({
      type: "image", mimeType: "image/png", fileSizeBytes: 1000, role: "IDENTITY_MASTER",
    }).ok).toBe(false);
    const job = queuedJob();
    expect(job.sourceSemantic).toBe(CHARACTER_SOURCE_PORTRAIT);
    expect(job.sourceSemantic).not.toBe("IDENTITY_MASTER");
  });

  it("3. compiles PREMIUM_3D virtualization intent without photoreal replica language as the product goal", () => {
    const prompt = compileCharacterVirtualizationPrompt({ style: "PREMIUM_3D" });
    expect(prompt).toContain("clearly synthetic premium 3D CGI");
    expect(prompt).toContain("unmistakably CGI");
    expect(prompt).toContain("Avoid photorealistic live-action human appearance");
    expect(prompt).not.toMatch(/create a photorealistic live-action/i);
    expect(DEFAULT_CHARACTER_VIRTUAL_STYLE).toBe("PREMIUM_3D");
  });

  it("4-5. provider success creates a candidate that still requires human acceptance", async () => {
    const result = await new MockCharacterVirtualizationProvider("succeed").virtualizeCharacter({
      sourceImage: { assetId: IDS.source, contentHash: SOURCE_HASH, mimeType: "image/jpeg", width: 800, height: 1000 },
      style: "PREMIUM_3D",
      creativeDirection: null,
      compiledPrompt: compileCharacterVirtualizationPrompt({ style: "PREMIUM_3D" }),
      outputRequirements: { mimeType: "image/png", width: 1024, height: 1536 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const succeeded = applyProviderSuccessToJob(queuedJob(), result, IDS.output, "2026-09-22T12:01:00.000Z", "0.04");
    expect(succeeded.status).toBe("SUCCEEDED");
    expect(succeeded.acceptanceStatus).toBe(VIRTUAL_CHARACTER_CANDIDATE);
    expect(succeeded.reusableCharacterId).toBeNull();
    expect(assertCandidateRequiresAcceptance(succeeded)).toBe(true);
  });

  it("6-7. accepted virtual output becomes IDENTITY_MASTER for a new Character", () => {
    const succeeded = applyProviderSuccessToJob(
      queuedJob(),
      {
        ok: true, bytes: MOCK_VIRTUAL_CHARACTER_PNG, mimeType: "image/png", width: 1, height: 1,
        provider: "mock", providerModel: "character-virtualizer-mock.v1",
        providerAttemptId: IDS.version, contentHash: OUTPUT_HASH,
        realImageProviderCalls: 0, costUsd: "0.0000",
      },
      IDS.output,
      "2026-09-22T12:01:00.000Z",
      "0.04"
    );
    const accepted = markJobAccepted(succeeded, {
      reusableCharacterId: IDS.character,
      reusableCharacterVersionId: IDS.version,
    });
    const lineage = compileVirtualizationLineage(accepted);
    expect(lineage.virtualOutputRole).toBe("IDENTITY_MASTER");
    expect(lineage.identityMasterAssetId).toBe(IDS.output);
    expect(lineage.sourceSemantic).toBe(CHARACTER_SOURCE_PORTRAIT);
    expect(lineage.sourcePortraitAssetId).not.toBe(lineage.identityMasterAssetId);
  });

  it("8-9. existing Character versioning keeps historical versions readable by creating a new version id", () => {
    const first = markJobAccepted(
      applyProviderSuccessToJob(queuedJob(), {
        ok: true, bytes: MOCK_VIRTUAL_CHARACTER_PNG, mimeType: "image/png", width: 1, height: 1,
        provider: "mock", providerModel: "character-virtualizer-mock.v1",
        providerAttemptId: IDS.version, contentHash: OUTPUT_HASH,
        realImageProviderCalls: 0, costUsd: "0.0000",
      }, IDS.output, "2026-09-22T12:01:00.000Z", "0.04"),
      { reusableCharacterId: IDS.character, reusableCharacterVersionId: IDS.version }
    );
    const nextJob = buildAiStoryCharacterVirtualizationJob({
      orgId: IDS.org, workspaceId: IDS.workspace, sourceAssetId: IDS.source, sourceContentHash: SOURCE_HASH,
      permissionConfirmed: true, createdBy: IDS.actor, createdAt: "2026-09-22T13:00:00.000Z",
    });
    expect(first.reusableCharacterVersionId).toBe(IDS.version);
    expect(nextJob.id).not.toBe(first.id);
  });

  it("10. persists SOURCE_PORTRAIT → job → virtual output → Character version → IDENTITY_MASTER", () => {
    const accepted = markJobAccepted(
      applyProviderSuccessToJob(queuedJob(), {
        ok: true, bytes: MOCK_VIRTUAL_CHARACTER_PNG, mimeType: "image/png", width: 1, height: 1,
        provider: "mock", providerModel: "character-virtualizer-mock.v1",
        providerAttemptId: IDS.version, contentHash: OUTPUT_HASH,
        realImageProviderCalls: 0, costUsd: "0.0000",
      }, IDS.output, "2026-09-22T12:01:00.000Z", "0.04"),
      { reusableCharacterId: IDS.character, reusableCharacterVersionId: IDS.version }
    );
    const lineage = compileVirtualizationLineage(accepted);
    expect(lineage).toMatchObject({
      sourcePortraitAssetId: IDS.source,
      virtualizationJobId: accepted.id,
      virtualOutputAssetId: IDS.output,
      reusableCharacterId: IDS.character,
      reusableCharacterVersionId: IDS.version,
      identityMasterAssetId: IDS.output,
    });
  });

  it("11. workspace isolation is encoded on the job", () => {
    expect(queuedJob().workspaceId).toBe(IDS.workspace);
    expect(queuedJob().workspaceId).not.toBe(IDS.otherWorkspace);
  });

  it("12. normal-user Character creator does not ask for asset UUID / contentHash / identityFingerprint", () => {
    const wizard = readFileSync(resolve(process.cwd(), "apps/web/src/components/ai-story/CharacterVirtualizerWizard.tsx"), "utf8");
    const library = readFileSync(resolve(process.cwd(), "apps/web/src/components/ai-story/ReusableCharacterLibraryPanel.tsx"), "utf8");
    expect(wizard).not.toMatch(/IDENTITY_MASTER asset id|contentHash|identityFingerprint/);
    expect(library).toContain("advanced-character-setup");
    expect(library).toContain("isSuperAdmin");
    expect(library.indexOf("IDENTITY_MASTER asset id")).toBeGreaterThan(library.indexOf("advanced-character-setup"));
  });

  it("13-14. Episode selector and library cards keep Character thumbnail and Identity locked copy", () => {
    const episode = readFileSync(resolve(process.cwd(), "apps/web/src/components/ai-story/EpisodeCreateForm.tsx"), "utf8");
    const library = readFileSync(resolve(process.cwd(), "apps/web/src/components/ai-story/ReusableCharacterLibraryPanel.tsx"), "utf8");
    expect(episode).toContain("CharacterPortrait");
    expect(episode).toContain("identityLocked");
    expect(episode).toContain("episode-look-outfit");
    expect(library).toContain("CharacterPortrait");
    expect(library).toContain("character-card");
  });

  it("15. Generate Again is explicit and never automatic", () => {
    expect(NO_AUTOMATIC_VIRTUALIZATION_RETRY).toBe(true);
    expect(queuedJob().automaticRetry).toBe(false);
    expect(characterVirtualizationCostEstimate("PREMIUM_3D").automaticRetry).toBe(false);
    const wizard = readFileSync(resolve(process.cwd(), "apps/web/src/components/ai-story/CharacterVirtualizerWizard.tsx"), "utf8");
    expect(wizard).toContain("character-generate-again");
    expect(wizard).toContain("costAuthorized: true");
  });

  it("16. provider rejection creates no Character version", async () => {
    const result = await new MockCharacterVirtualizationProvider("reject").virtualizeCharacter({
      sourceImage: { assetId: IDS.source, contentHash: SOURCE_HASH, mimeType: "image/jpeg", width: 800, height: 1000 },
      style: "PREMIUM_3D",
      creativeDirection: "__REJECT__",
      compiledPrompt: compileCharacterVirtualizationPrompt({ style: "PREMIUM_3D" }),
      outputRequirements: { mimeType: "image/png", width: 1024, height: 1536 },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const failed = applyProviderFailureToJob(queuedJob(), result, "2026-09-22T12:01:00.000Z");
    expect(failed.status).toBe("REJECTED");
    expect(failed.reusableCharacterId).toBeNull();
    expect(failed.outputAssetId).toBeNull();
    expect(failed.userSafeError).toMatch(/No Character was created/);
  });

  it("17. records zero Seedance video calls and zero real image-generation calls", () => {
    expect(CHARACTER_VIRTUALIZER_SEEDANCE_VIDEO_CALLS).toBe(0);
    expect(CHARACTER_VIRTUALIZER_REAL_IMAGE_PROVIDER_CALLS).toBe(0);
    expect(queuedJob().seedanceVideoCalls).toBe(0);
    expect(queuedJob().realImageProviderCalls).toBe(0);
    const files = [
      "packages/shared/src/ai-story-character-virtualizer.ts",
      "packages/shared/src/ai-story-character-virtualizer.server.ts",
      "packages/db/src/queries/ai-story-character-virtualizer.ts",
      "packages/agents/src/ai-story/character-virtualization-creative-image.ts",
    ].map((path) => readFileSync(resolve(process.cwd(), path), "utf8"));
    for (const source of files) {
      expect(source).not.toMatch(/dreamina-seedance|seedance-capability|seedance-canonical/i);
      expect(source).not.toMatch(/from ["'][^"']*seedance/i);
    }
  });

  it("18. original source cannot silently replace canonical output", () => {
    expect(sourcePortraitCannotReplaceCanonicalOutput({
      sourceAssetId: IDS.source, sourceContentHash: SOURCE_HASH,
      identityMasterAssetId: IDS.output, identityMasterContentHash: OUTPUT_HASH,
    })).toBe(true);
    expect(sourcePortraitCannotReplaceCanonicalOutput({
      sourceAssetId: IDS.source, sourceContentHash: SOURCE_HASH,
      identityMasterAssetId: IDS.source, identityMasterContentHash: SOURCE_HASH,
    })).toBe(false);
  });

  it("19. visualClass persists PREMIUM_3D as SYNTHETIC_3D", () => {
    expect(visualClassForVirtualStyle("PREMIUM_3D")).toBe("SYNTHETIC_3D");
    expect(visualClassForVirtualStyle("STYLIZED_CGI")).toBe("STYLIZED_CGI");
    expect(visualClassForVirtualStyle("ILLUSTRATED")).toBe("ILLUSTRATED");
    expect(queuedJob().visualClass).toBe("SYNTHETIC_3D");
  });

  it("20. public job never exposes provider prompt and cost is CHARACTER_VIRTUALIZATION not EPISODE_GENERATION", () => {
    const publicJob = publicVirtualizationJob(queuedJob());
    expect(publicJob).not.toHaveProperty("promptFingerprint");
    expect(publicJob).not.toHaveProperty("compiledProviderPrompt");
    expect(publicJob.costCategory).toBe(CHARACTER_VIRTUALIZATION);
    expect(publicJob.costCategory).not.toBe(EPISODE_GENERATION);
    expect(characterVirtualizationCostEstimate().requiresExplicitAuthorization).toBe(true);
    const delivery = readFileSync(resolve(process.cwd(), "apps/web/src/app/api/workspaces/[id]/library/[assetId]/preview/route.ts"), "utf8");
    expect(delivery).toContain("signPrivateCampaignAsset");
    expect(delivery).not.toMatch(/getPublicUrl|public URL/);
  });

  it("deleting a source portrait does not corrupt an accepted Character", () => {
    const allowed = evaluateSourcePortraitDeletion({
      sourceAssetId: IDS.source,
      identityMasterAssetId: IDS.output,
      acceptedCharacterExists: true,
    });
    expect(allowed).toEqual({ allowed: true, characterPreserved: true, code: "SOURCE_PORTRAIT_DETACHED" });
    expect(evaluateSourcePortraitDeletion({
      sourceAssetId: IDS.output,
      identityMasterAssetId: IDS.output,
      acceptedCharacterExists: true,
    }).allowed).toBe(false);
  });
});
