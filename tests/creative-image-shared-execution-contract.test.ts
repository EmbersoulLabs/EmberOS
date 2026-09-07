import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CREATIVE_IMAGE_EXECUTION_CONTRACT_VERSION,
  CREATIVE_IMAGE_EXECUTION_ERROR_CODES,
  CreativeImageAdapterError,
  CreativeImageExecutionService,
  type CreativeImageExecutionAuthorization,
  type CreativeImageGenerationAdapter,
  type CreativeImageGenerationInput,
  type CreativeImageGenerationOutput,
} from "../packages/agents/src/creative-image";

function digest(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function request(overrides: Partial<CreativeImageGenerationInput> = {}): CreativeImageGenerationInput {
  const referenceBytes = Buffer.from("generic-reference");
  return {
    contractVersion: CREATIVE_IMAGE_EXECUTION_CONTRACT_VERSION,
    scope: { tenantId: "tenant-1", workspaceId: "workspace-1" },
    executionIdentity: "generation-1",
    idempotencyKey: "idempotency-1",
    authorizationId: "authorization-1",
    prompt: "Create a generic product composition.",
    references: [{
      assetId: "asset-1",
      contentHash: digest(referenceBytes),
      mimeType: "image/png",
      bytes: referenceBytes,
      role: "REFERENCE_IMAGE",
    }],
    requestedOutput: { mimeType: "image/png", width: 1024, height: 1024, quality: "HIGH" },
    ...overrides,
  };
}

function authorization(
  target: CreativeImageGenerationInput,
  overrides: Partial<CreativeImageExecutionAuthorization> = {}
): CreativeImageExecutionAuthorization {
  return {
    contractVersion: CREATIVE_IMAGE_EXECUTION_CONTRACT_VERSION,
    authorizationId: target.authorizationId,
    executionIdentity: target.executionIdentity,
    idempotencyKey: target.idempotencyKey,
    scope: target.scope,
    providerId: "deterministic",
    modelId: "fixture-v1",
    maximumProviderCalls: 1,
    authorizedBy: "test-authority",
    authorizedAt: "2026-09-07T00:00:00.000Z",
    ...overrides,
  };
}

class DeterministicAdapter implements CreativeImageGenerationAdapter {
  readonly providerId = "deterministic";
  readonly modelId = "fixture-v1";
  readonly adapterVersion = "test-v1";
  readonly externalPaidCall = true;
  readonly invocations: CreativeImageGenerationInput[] = [];

  constructor(private readonly behavior?: (input: CreativeImageGenerationInput) => Promise<CreativeImageGenerationOutput>) {}

  async generate(input: CreativeImageGenerationInput): Promise<CreativeImageGenerationOutput> {
    this.invocations.push(input);
    if (this.behavior) return this.behavior(input);
    return {
      bytes: Buffer.from("generated-image"),
      mimeType: "image/png",
      providerId: this.providerId,
      modelId: this.modelId,
      adapterVersion: this.adapterVersion,
      providerRequestId: "provider-request-1",
      revisedPrompt: "Provider revised prompt",
      usage: { inputUnits: 1, providerReportedCost: { currency: "USD", amount: 0.01 } },
      metadata: {
        finishReason: "complete",
        authorizationToken: "must-not-escape",
        providerUrl: "https://example.invalid/image?token=must-not-escape",
      },
      rawSdkResponse: { apiKey: "must-not-escape" },
    } as CreativeImageGenerationOutput;
  }
}

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return entry.isFile() && target.endsWith(".ts") ? [target] : [];
  }));
  return nested.flat();
}

describe("shared Creative Image execution boundary", () => {
  it("accepts generic references without requiring Story-specific authority", async () => {
    const adapter = new DeterministicAdapter();
    const service = new CreativeImageExecutionService({ adapter });
    const input = request();
    const result = await service.execute({ request: input, authorization: authorization(input) });

    expect(result.status).toBe("SUCCEEDED");
    expect(input.references[0]).toMatchObject({ assetId: "asset-1", role: "REFERENCE_IMAGE" });
    expect(input).not.toHaveProperty("activeIntent");
    expect(input).not.toHaveProperty("narrativeWorldState");
    expect(input).not.toHaveProperty("humanReview");
    expect(input).not.toHaveProperty("providerPolicyEligibility");
  });

  it("fails closed before adapter invocation when authorization is absent or has zero calls", async () => {
    const adapter = new DeterministicAdapter();
    const service = new CreativeImageExecutionService({ adapter });
    const input = request();
    const absent = await service.execute({ request: input });
    const zero = await service.execute({ request: input, authorization: authorization(input, { maximumProviderCalls: 0 }) });

    expect(absent.status === "FAILED" && absent.failure.code).toBe("AUTHORIZATION_REQUIRED");
    expect(zero.status === "FAILED" && zero.failure.code).toBe("AUTHORIZATION_EXHAUSTED");
    expect(adapter.invocations).toHaveLength(0);
  });

  it("uses one invocation for one authorized identity and replays only the same identity", async () => {
    const adapter = new DeterministicAdapter();
    const service = new CreativeImageExecutionService({ adapter });
    const input = request();
    const authority = authorization(input);
    const first = await service.execute({ request: input, authorization: authority });
    const replay = await service.execute({ request: input, authorization: authority });

    expect(first.status).toBe("SUCCEEDED");
    expect(replay.status).toBe("SUCCEEDED");
    expect(replay.replayed).toBe(true);
    expect(adapter.invocations).toHaveLength(1);

    const conflicting = request({ idempotencyKey: "different-key", authorizationId: "different-authorization" });
    const conflict = await service.execute({ request: conflicting, authorization: authorization(conflicting) });
    expect(conflict.status === "FAILED" && conflict.failure.code).toBe("INVALID_INPUT");
    expect(adapter.invocations).toHaveLength(1);
  });

  it("normalizes output and excludes raw SDK and secret-bearing metadata", async () => {
    const adapter = new DeterministicAdapter();
    const service = new CreativeImageExecutionService({ adapter });
    const input = request();
    const result = await service.execute({ request: input, authorization: authorization(input) });

    expect(result.status).toBe("SUCCEEDED");
    if (result.status !== "SUCCEEDED") return;
    expect(result.output.usage?.providerReportedCost).toEqual({ currency: "USD", amount: 0.01 });
    expect(result.output.metadata).toEqual({
      finishReason: "complete",
      providerUrl: "https://example.invalid/image?token=[REDACTED]",
    });
    expect(result.output).not.toHaveProperty("rawSdkResponse");
    expect(JSON.stringify(result.output)).not.toContain("must-not-escape");
  });

  it("maps bounded Provider failures without leaking native secrets", async () => {
    const adapter = new DeterministicAdapter(async () => {
      throw new CreativeImageAdapterError(
        "PROVIDER_REJECTED",
        "rejected using Bearer secret-token",
        { status: 400, code: "POLICY", type: "BadRequest", message: "key sk-sensitive", requestId: "trace-1" }
      );
    });
    const service = new CreativeImageExecutionService({ adapter });
    const input = request();
    const result = await service.execute({ request: input, authorization: authorization(input) });

    expect(result.status === "FAILED" && result.failure.code).toBe("PROVIDER_REJECTED");
    expect(JSON.stringify(result)).not.toContain("secret-token");
    expect(JSON.stringify(result)).not.toContain("sk-sensitive");
    expect(result.status === "FAILED" && result.failure.providerEvidence?.status).toBe(400);
  });

  it("maps invalid adapter output to PROVIDER_RESULT_INVALID", async () => {
    const adapter = new DeterministicAdapter(async () => ({
      bytes: Buffer.alloc(0),
      mimeType: "image/png",
      providerId: "deterministic",
      modelId: "fixture-v1",
      adapterVersion: "test-v1",
      providerRequestId: "provider-request-1",
    }));
    const service = new CreativeImageExecutionService({ adapter });
    const input = request();
    const result = await service.execute({ request: input, authorization: authorization(input) });
    expect(result.status === "FAILED" && result.failure.code).toBe("PROVIDER_RESULT_INVALID");
  });

  it("validates reference content integrity before adapter invocation", async () => {
    const adapter = new DeterministicAdapter();
    const service = new CreativeImageExecutionService({ adapter });
    const input = request({ references: [{
      assetId: "asset-1",
      contentHash: `sha256:${"0".repeat(64)}`,
      mimeType: "image/png",
      bytes: Buffer.from("different"),
      role: "INPUT_IMAGE",
    }] });
    const result = await service.execute({ request: input, authorization: authorization(input) });
    expect(result.status === "FAILED" && result.failure.code).toBe("INVALID_INPUT");
    expect(adapter.invocations).toHaveLength(0);
  });

  it("exports the complete bounded generic error vocabulary", () => {
    expect(CREATIVE_IMAGE_EXECUTION_ERROR_CODES).toEqual([
      "INVALID_INPUT",
      "AUTHORIZATION_REQUIRED",
      "AUTHORIZATION_EXHAUSTED",
      "PROVIDER_UNAVAILABLE",
      "PROVIDER_REJECTED",
      "PROVIDER_RESULT_INVALID",
      "EXECUTION_FAILED",
    ]);
  });

  it("is not imported by existing AI Story or Photo Scene runtime paths", async () => {
    const roots = [
      path.resolve("packages/agents/src/ai-story"),
      path.resolve("packages/agents/src/photo-scene"),
    ];
    const files = (await Promise.all(roots.map(sourceFiles))).flat();
    const contents = await Promise.all(files.map((file) => readFile(file, "utf8")));
    for (const content of contents) {
      expect(content).not.toMatch(/CreativeImageExecutionService|from\s+["'][^"']*creative-image/);
    }
  });

  it("contains no Provider SDK implementation in the shared namespace", async () => {
    const files = await sourceFiles(path.resolve("packages/agents/src/creative-image"));
    const contents = (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("\n");
    expect(contents).not.toMatch(/from\s+["']openai["']|new\s+OpenAI|images\.edit|images\.generate/);
  });
});
