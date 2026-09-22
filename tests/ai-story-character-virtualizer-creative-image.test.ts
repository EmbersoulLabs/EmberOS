import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHARACTER_SOURCE_PORTRAIT,
  CHARACTER_VIRTUALIZATION_MAX_RETRIES,
  CHARACTER_VIRTUALIZATION_OPENAI_MODEL,
  CHARACTER_VIRTUALIZATION_OPENAI_OPERATION,
  CHARACTER_VIRTUALIZATION_OPENAI_PROVIDER,
  CHARACTER_VIRTUALIZATION_OUTPUT,
  CHARACTER_VIRTUALIZATION_SOURCE_REFERENCE_ROLE,
  VIRTUAL_CHARACTER_CANDIDATE,
  assertCandidateRequiresAcceptance,
  readCharacterVirtualizationProviderMode,
} from "@ceo-agent/shared";
import {
  CreativeImageAdapterError,
  CreativeImageExecutionService,
  OpenAiCreativeImageGenerationAdapter,
  OPENAI_CREATIVE_IMAGE_ADAPTER_VERSION,
  OPENAI_CREATIVE_IMAGE_MODEL,
  compileCharacterVirtualizationCreativeImageRequest,
  compilePremium3dDryCertificationRequest,
  CreativeImageCharacterVirtualizationBridge,
  resolveCharacterVirtualizationRuntime,
  type CreativeImageGenerationAdapter,
  type CreativeImageGenerationInput,
  type CreativeImageGenerationOutput,
} from "@ceo-agent/agents";
import {
  MOCK_VIRTUAL_CHARACTER_PNG,
  applyProviderFailureToJob,
  applyProviderSuccessToJob,
  buildAiStoryCharacterVirtualizationJob,
  compileCharacterVirtualizationPrompt,
  hashCharacterVirtualizationBytes,
  markJobAccepted,
  resolveCharacterVirtualizationProvider,
} from "@ceo-agent/shared/server";

const IDS = {
  org: "81000000-0000-4000-8000-000000000001",
  workspace: "81000000-0000-4000-8000-000000000002",
  otherWorkspace: "81000000-0000-4000-8000-000000000003",
  actor: "81000000-0000-4000-8000-000000000004",
  source: "81000000-0000-4000-8000-000000000005",
  output: "81000000-0000-4000-8000-000000000006",
  character: "81000000-0000-4000-8000-000000000007",
  version: "81000000-0000-4000-8000-000000000008",
  auth: "81000000-0000-4000-8000-000000000009",
  auth2: "81000000-0000-4000-8000-00000000000a",
};

const SOURCE_BYTES = Buffer.concat([MOCK_VIRTUAL_CHARACTER_PNG, Buffer.from([0x11])]);
const SOURCE_HASH = hashCharacterVirtualizationBytes(SOURCE_BYTES);
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
    createdAt: "2026-09-22T16:00:00.000Z",
    provider: "openai",
    providerModel: "gpt-image-2",
  });
}

function authorization(id = IDS.auth) {
  return {
    authorizationId: id,
    executionIdentity: id,
    idempotencyKey: id,
    scope: { tenantId: IDS.org, workspaceId: IDS.workspace },
    authorizedBy: IDS.actor,
    authorizedAt: "2026-09-22T16:00:00.000Z",
    maximumProviderCalls: 1 as const,
  };
}

function providerRequest(overrides?: Partial<ReturnType<typeof baseRequest>>) {
  return { ...baseRequest(), ...overrides };
}

function baseRequest() {
  return {
    sourceImage: {
      assetId: IDS.source,
      contentHash: SOURCE_HASH,
      mimeType: "image/png" as const,
      width: 800,
      height: 1200,
      bytes: SOURCE_BYTES,
    },
    style: "PREMIUM_3D" as const,
    creativeDirection: "friendly SME spokesperson",
    compiledPrompt: compileCharacterVirtualizationPrompt({
      style: "PREMIUM_3D",
      creativeDirection: "friendly SME spokesperson",
    }),
    outputRequirements: {
      mimeType: CHARACTER_VIRTUALIZATION_OUTPUT.mimeType,
      width: CHARACTER_VIRTUALIZATION_OUTPUT.width,
      height: CHARACTER_VIRTUALIZATION_OUTPUT.height,
    },
    authorization: authorization(),
  };
}

class RecordingCreativeImageAdapter implements CreativeImageGenerationAdapter {
  readonly providerId = CHARACTER_VIRTUALIZATION_OPENAI_PROVIDER;
  readonly modelId = OPENAI_CREATIVE_IMAGE_MODEL;
  readonly adapterVersion = OPENAI_CREATIVE_IMAGE_ADAPTER_VERSION;
  readonly externalPaidCall = true;
  calls = 0;
  last: CreativeImageGenerationInput | undefined;
  constructor(private readonly behavior: "succeed" | "reject" | "unavailable" | "invalid" = "succeed") {}
  async generate(input: CreativeImageGenerationInput): Promise<CreativeImageGenerationOutput> {
    this.calls += 1;
    this.last = input;
    if (this.behavior === "reject") throw new CreativeImageAdapterError("PROVIDER_REJECTED", "rejected");
    if (this.behavior === "unavailable") throw new CreativeImageAdapterError("PROVIDER_UNAVAILABLE", "unavailable");
    if (this.behavior === "invalid") throw new CreativeImageAdapterError("PROVIDER_RESULT_INVALID", "invalid");
    return {
      bytes: Buffer.from(MOCK_VIRTUAL_CHARACTER_PNG),
      mimeType: "image/png",
      providerId: this.providerId,
      modelId: this.modelId,
      adapterVersion: this.adapterVersion,
      providerRequestId: `openai-image:${input.idempotencyKey}`,
      metadata: { operation: CHARACTER_VIRTUALIZATION_OPENAI_OPERATION, retries: CHARACTER_VIRTUALIZATION_MAX_RETRIES },
    };
  }
}

function walkTsFiles(root: string): string[] {
  const entries = readdirSync(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = `${root}/${entry.name}`;
    if (entry.isDirectory()) files.push(...walkTsFiles(path));
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) files.push(path);
  }
  return files;
}

describe("AI Story Character Virtualizer Creative Image wiring", () => {
  it("1. PREMIUM_3D compiles into a shared Creative Image request", () => {
    const compiled = compileCharacterVirtualizationCreativeImageRequest({
      request: providerRequest(),
      authorization: authorization(),
    });
    expect(compiled.prompt).toContain("clearly synthetic premium 3D CGI");
    expect(compiled.prompt).toContain("synthetic reusable brand Character");
    expect(compiled.references).toHaveLength(1);
    expect(compiled.references[0]?.role).toBe(CHARACTER_VIRTUALIZATION_SOURCE_REFERENCE_ROLE);
    expect(compiled.requestedOutput).toMatchObject({
      mimeType: "image/png",
      width: 1024,
      height: 1536,
      sizeConstraint: "1024x1536",
      quality: "STANDARD",
    });
  });

  it("2. existing OpenAI Creative Image adapter is reused and no second SDK wrapper exists", () => {
    expect(OPENAI_CREATIVE_IMAGE_MODEL).toBe("gpt-image-2");
    const adapterSource = readFileSync(
      resolve(process.cwd(), "packages/agents/src/creative-image/openai-creative-image-adapter.ts"),
      "utf8"
    );
    expect(adapterSource).toContain("this.client.images.edit");
    expect(adapterSource).toContain("maxRetries: 0");
    expect(adapterSource).toContain('quality: input.requestedOutput.quality === "HIGH" ? "high" : "medium"');
    const bridge = readFileSync(
      resolve(process.cwd(), "packages/agents/src/ai-story/character-virtualization-creative-image.ts"),
      "utf8"
    );
    expect(bridge).toContain("createOpenAiCreativeImageGenerationAdapter");
    expect(bridge).toContain("OpenAiCreativeImageGenerationAdapter");
    expect(bridge).not.toMatch(/from ["']openai["']/);
    expect(bridge).not.toMatch(/images\.edit\s*\(/);
    expect(bridge).not.toMatch(/class CharacterVirtualizerOpenAIAdapter/);
    expect(existsSync(resolve(process.cwd(), "packages/agents/src/ai-story/character-virtualizer-openai-adapter.ts"))).toBe(false);
    const editCalls = walkTsFiles(resolve(process.cwd(), "packages/agents/src")).filter((path) =>
      readFileSync(path, "utf8").includes("this.client.images.edit")
    );
    expect(editCalls).toHaveLength(1);
    expect(editCalls[0]?.replaceAll("\\", "/")).toMatch(/creative-image\/openai-creative-image-adapter\.ts$/);
  });

  it("3. no second OpenAI SDK adapter exists in Character Virtualizer files", () => {
    const files = [
      "packages/shared/src/ai-story-character-virtualizer.ts",
      "packages/shared/src/ai-story-character-virtualizer.server.ts",
      "packages/db/src/queries/ai-story-character-virtualizer.ts",
      "apps/web/src/lib/character-virtualizer-access.ts",
    ].map((path) => readFileSync(resolve(process.cwd(), path), "utf8"));
    for (const source of files) {
      expect(source).not.toMatch(/from ["']openai["']/);
      expect(source).not.toMatch(/new OpenAI\(/);
      expect(source).not.toMatch(/images\.edit\s*\(/);
    }
  });

  it("4. source portrait becomes the provider reference only", () => {
    const compiled = compileCharacterVirtualizationCreativeImageRequest({
      request: providerRequest(),
      authorization: authorization(),
    });
    expect(compiled.references[0]).toMatchObject({
      assetId: IDS.source,
      contentHash: SOURCE_HASH,
      role: "INPUT_IMAGE",
    });
    expect(compiled.prompt).not.toMatch(/https?:\/\//);
    expect(JSON.stringify(compiled.references[0])).not.toContain("storage/v1/object");
  });

  it("5. source portrait never becomes IDENTITY_MASTER", () => {
    const job = queuedJob();
    expect(job.sourceSemantic).toBe(CHARACTER_SOURCE_PORTRAIT);
    const succeeded = applyProviderSuccessToJob(
      job,
      {
        ok: true,
        bytes: MOCK_VIRTUAL_CHARACTER_PNG,
        mimeType: "image/png",
        width: 1024,
        height: 1536,
        provider: "openai",
        providerModel: "gpt-image-2",
        providerAttemptId: IDS.version,
        contentHash: OUTPUT_HASH,
        realImageProviderCalls: 1,
        costUsd: null,
      },
      IDS.output,
      "2026-09-22T16:01:00.000Z",
      "0.0000"
    );
    expect(succeeded.sourceAssetId).not.toBe(succeeded.outputAssetId);
    expect(succeeded.outputSemantic).toBe(VIRTUAL_CHARACTER_CANDIDATE);
  });

  it("6. Provider success creates a candidate only", async () => {
    const adapter = new RecordingCreativeImageAdapter("succeed");
    const result = await new CreativeImageCharacterVirtualizationBridge(adapter).virtualizeCharacter(providerRequest());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const succeeded = applyProviderSuccessToJob(queuedJob(), result, IDS.output, "2026-09-22T16:01:00.000Z", result.costUsd ?? "0.0000");
    expect(succeeded.acceptanceStatus).toBe(VIRTUAL_CHARACTER_CANDIDATE);
    expect(succeeded.reusableCharacterId).toBeNull();
    expect(assertCandidateRequiresAcceptance(succeeded)).toBe(true);
    expect(adapter.calls).toBe(1);
  });

  it("7. human acceptance creates/versions Reusable Character authority", () => {
    const succeeded = applyProviderSuccessToJob(
      queuedJob(),
      {
        ok: true,
        bytes: MOCK_VIRTUAL_CHARACTER_PNG,
        mimeType: "image/png",
        width: 1024,
        height: 1536,
        provider: "openai",
        providerModel: "gpt-image-2",
        providerAttemptId: IDS.version,
        contentHash: OUTPUT_HASH,
        realImageProviderCalls: 1,
        costUsd: null,
      },
      IDS.output,
      "2026-09-22T16:01:00.000Z",
      "0.0000"
    );
    const accepted = markJobAccepted(succeeded, {
      reusableCharacterId: IDS.character,
      reusableCharacterVersionId: IDS.version,
    });
    expect(accepted.acceptanceStatus).toBe("ACCEPTED");
    expect(accepted.outputSemantic).toBe("ACCEPTED_VIRTUAL_IDENTITY_MASTER");
    expect(accepted.reusableCharacterVersionId).toBe(IDS.version);
  });

  it("8. Provider reject creates no Character version", async () => {
    const result = await new CreativeImageCharacterVirtualizationBridge(
      new RecordingCreativeImageAdapter("reject")
    ).virtualizeCharacter(providerRequest());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const failed = applyProviderFailureToJob(queuedJob(), result, "2026-09-22T16:01:00.000Z");
    expect(failed.status).toBe("REJECTED");
    expect(failed.reusableCharacterId).toBeNull();
    expect(failed.outputAssetId).toBeNull();
  });

  it("9. Provider unavailable creates no Character version", async () => {
    const result = await new CreativeImageCharacterVirtualizationBridge(
      new RecordingCreativeImageAdapter("unavailable")
    ).virtualizeCharacter(providerRequest());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("PROVIDER_UNAVAILABLE");
    const failed = applyProviderFailureToJob(queuedJob(), result, "2026-09-22T16:01:00.000Z");
    expect(failed.status).toBe("FAILED");
    expect(failed.reusableCharacterId).toBeNull();
  });

  it("10. retries = 0", () => {
    const compiled = compileCharacterVirtualizationCreativeImageRequest({
      request: providerRequest(),
      authorization: authorization(),
    });
    expect(compiled.correlationMetadata?.retries).toBe(0);
    expect(CHARACTER_VIRTUALIZATION_MAX_RETRIES).toBe(0);
    const adapter = new OpenAiCreativeImageGenerationAdapter({
      images: { edit: async () => ({ data: [] }) },
    } as never);
    expect(adapter.modelId).toBe("gpt-image-2");
    expect(adapter.providerId).toBe("openai");
  });

  it("11. Generate Again requires a new authorization", async () => {
    const adapter = new RecordingCreativeImageAdapter("succeed");
    const execution = new CreativeImageExecutionService({ adapter });
    const bridge = new CreativeImageCharacterVirtualizationBridge(adapter, execution);
    const first = await bridge.virtualizeCharacter(providerRequest({ authorization: authorization(IDS.auth) }));
    expect(first.ok).toBe(true);
    const reused = await bridge.virtualizeCharacter(
      providerRequest({
        authorization: {
          ...authorization(IDS.auth),
          executionIdentity: IDS.version,
          idempotencyKey: IDS.version,
        },
      })
    );
    expect(reused.ok).toBe(false);
    const second = await bridge.virtualizeCharacter(providerRequest({ authorization: authorization(IDS.auth2) }));
    expect(second.ok).toBe(true);
    expect(adapter.calls).toBe(2);
  });

  it("12. workspace isolation remains intact on the compiled request", () => {
    const compiled = compileCharacterVirtualizationCreativeImageRequest({
      request: providerRequest(),
      authorization: authorization(),
    });
    expect(compiled.scope.workspaceId).toBe(IDS.workspace);
    expect(compiled.scope.workspaceId).not.toBe(IDS.otherWorkspace);
    expect(compiled.scope.tenantId).toBe(IDS.org);
  });

  it("13. private signed asset delivery remains intact", () => {
    const delivery = readFileSync(
      resolve(process.cwd(), "apps/web/src/app/api/workspaces/[id]/library/[assetId]/preview/route.ts"),
      "utf8"
    );
    const access = readFileSync(
      resolve(process.cwd(), "apps/web/src/lib/character-virtualizer-access.ts"),
      "utf8"
    );
    expect(delivery).toContain("signPrivateCampaignAsset");
    expect(access).toContain("isPhotoSceneTenantStoragePath");
    expect(access).not.toMatch(/getPublicUrl/);
  });

  it("14. mock provider still works for CI", () => {
    expect(readCharacterVirtualizationProviderMode({} as NodeJS.ProcessEnv)).toBe("mock");
    expect(readCharacterVirtualizationProviderMode({ CHARACTER_VIRTUALIZATION_PROVIDER: "mock" })).toBe("mock");
    const provider = resolveCharacterVirtualizationProvider({ CHARACTER_VIRTUALIZATION_PROVIDER: "mock" });
    expect(provider.providerId).toBe("mock");
    expect(provider.externalPaidCall).toBe(false);
    const runtime = resolveCharacterVirtualizationRuntime({ CHARACTER_VIRTUALIZATION_PROVIDER: "mock" });
    expect(runtime.mode).toBe("mock");
    expect(runtime.adapterClass).toBeNull();
  });

  it("15. CI makes 0 external image calls", () => {
    const dry = compilePremium3dDryCertificationRequest({
      orgId: IDS.org,
      workspaceId: IDS.workspace,
      sourceAssetId: IDS.source,
      sourceContentHash: SOURCE_HASH,
      mimeType: "image/png",
      bytes: SOURCE_BYTES,
      createdBy: IDS.actor,
      createdAt: "2026-09-22T16:00:00.000Z",
      authorizationId: IDS.auth,
    });
    expect(dry.plan.provider).toBe("openai");
    expect(dry.plan.model).toBe("gpt-image-2");
    expect(dry.plan.operation).toBe("images.edit");
    expect(dry.plan.references).toBe(1);
    expect(dry.plan.retries).toBe(0);
    expect(dry.plan.promptFingerprint.startsWith("sha256:")).toBe(true);
    expect(dry.plan.requestFingerprint.startsWith("sha256:")).toBe(true);
    expect(resolveCharacterVirtualizationRuntime({}).mode).toBe("mock");
    expect(() =>
      resolveCharacterVirtualizationRuntime({
        CHARACTER_VIRTUALIZATION_PROVIDER: "creative-image",
        OPENAI_API_KEY: "",
        AI_PROVIDER_OPENAI_API_KEY: "",
      })
    ).toThrow(/not available/i);
  });

  it("16. Seedance calls remain 0", () => {
    const source = readFileSync(
      resolve(process.cwd(), "packages/agents/src/ai-story/character-virtualization-creative-image.ts"),
      "utf8"
    );
    expect(source).not.toMatch(/seedance/i);
    expect(queuedJob().seedanceVideoCalls).toBe(0);
  });

  it("dry-certifies an Alicia-style PREMIUM_3D request without sending it", () => {
    const dry = compilePremium3dDryCertificationRequest({
      orgId: IDS.org,
      workspaceId: IDS.workspace,
      sourceAssetId: IDS.source,
      sourceContentHash: SOURCE_HASH,
      mimeType: "image/png",
      bytes: SOURCE_BYTES,
      createdBy: IDS.actor,
      createdAt: "2026-09-22T16:00:00.000Z",
      authorizationId: IDS.auth,
      creativeDirection: "friendly SME spokesperson",
    });
    expect(dry.creativeImageRequest.references).toHaveLength(1);
    expect(dry.plan).toMatchObject({
      provider: CHARACTER_VIRTUALIZATION_OPENAI_PROVIDER,
      model: CHARACTER_VIRTUALIZATION_OPENAI_MODEL,
      operation: CHARACTER_VIRTUALIZATION_OPENAI_OPERATION,
      retries: 0,
      references: 1,
      size: "1024x1536",
      openaiQuality: "medium",
      adapterClass: "OpenAiCreativeImageGenerationAdapter",
    });
    expect(dry.plan.promptFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(dry.plan.requestFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
