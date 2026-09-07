import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CREATIVE_IMAGE_EXECUTION_CONTRACT_VERSION,
  CreativeImageAdapterError,
  OPENAI_CREATIVE_IMAGE_MODEL,
  OpenAiCreativeImageGenerationAdapter,
  type CreativeImageGenerationAdapter,
  type CreativeImageGenerationInput,
} from "../packages/agents/src/creative-image";
import {
  OPENAI_SCENE_KEYFRAME_QC_MODEL,
  OpenAiSceneKeyframeAdapter,
} from "../packages/agents/src/ai-story/openai-scene-keyframe-adapter";
import type { SceneKeyframeGenerationInput } from "../packages/agents/src/ai-story/scene-keyframe-preparation";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

function hash(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function genericInput(): CreativeImageGenerationInput {
  return {
    contractVersion: CREATIVE_IMAGE_EXECUTION_CONTRACT_VERSION,
    scope: { tenantId: "tenant-1", workspaceId: "workspace-1", correlationId: "story-1:scene-2" },
    executionIdentity: "stable-execution",
    idempotencyKey: "stable-idempotency",
    authorizationId: "existing-ai-story-authorization",
    prompt: "Create the requested composition.",
    references: [
      { assetId: "product-1", contentHash: hash(PNG), mimeType: "image/png", bytes: PNG, role: "INPUT_IMAGE" },
      { assetId: "identity-1", contentHash: hash(PNG), mimeType: "image/png", bytes: PNG, role: "REFERENCE_IMAGE" },
    ],
    requestedOutput: { mimeType: "image/png", width: 1536, height: 1024, quality: "HIGH" },
  };
}

function mockClient(response: unknown, capture?: (body: Record<string, unknown>, options: Record<string, unknown>) => void) {
  return {
    images: {
      edit: async (body: Record<string, unknown>, options: Record<string, unknown>) => {
        capture?.(body, options);
        return response;
      },
    },
  } as never;
}

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return entry.isFile() && target.endsWith(".ts") ? [target] : [];
  }))).flat();
}

describe("OpenAI Creative Image adapter ownership", () => {
  it("implements the shared adapter and owns gpt-image-2", () => {
    const adapter: CreativeImageGenerationAdapter = new OpenAiCreativeImageGenerationAdapter(mockClient({ data: [] }));
    expect(adapter.providerId).toBe("openai");
    expect(adapter.modelId).toBe("gpt-image-2");
    expect(OPENAI_CREATIVE_IMAGE_MODEL).toBe("gpt-image-2");
    expect(adapter.externalPaidCall).toBe(true);
  });

  it("maps generic references to one canonical images.edit call with retries disabled", async () => {
    let body: Record<string, unknown> | undefined;
    let options: Record<string, unknown> | undefined;
    let calls = 0;
    const adapter = new OpenAiCreativeImageGenerationAdapter(mockClient({
      data: [{ b64_json: PNG.toString("base64"), revised_prompt: "bounded revision" }],
      usage: { input_tokens: 12, output_tokens: 34 },
      _request_id: "request-1",
    }, (nextBody, nextOptions) => {
      calls += 1;
      body = nextBody;
      options = nextOptions;
    }));

    const output = await adapter.generate(genericInput());
    expect(calls).toBe(1);
    expect(body).toMatchObject({ model: "gpt-image-2", n: 1, quality: "high", size: "1536x1024" });
    expect((body?.image as Array<{ name?: string }>)).toHaveLength(2);
    expect((body?.image as Array<{ name?: string }>).map((file) => file.name)).toEqual([
      "input_image-1-product-1.png",
      "reference_image-2-identity-1.png",
    ]);
    expect(options).toEqual({ maxRetries: 0, headers: { "Idempotency-Key": "stable-idempotency" } });
    expect(output).toEqual(expect.objectContaining({
      bytes: PNG,
      mimeType: "image/png",
      providerId: "openai",
      modelId: "gpt-image-2",
      providerRequestId: "request-1",
      revisedPrompt: "bounded revision",
      usage: { inputUnits: 12, outputUnits: 34 },
      metadata: { operation: "images.edit", retries: 0 },
    }));
    expect(output).not.toHaveProperty("data");
    expect(output).not.toHaveProperty("rawResponse");
  });

  it("fails closed for missing output and sanitizes Provider errors", async () => {
    const missing = new OpenAiCreativeImageGenerationAdapter(mockClient({ data: [] }));
    await expect(missing.generate(genericInput())).rejects.toMatchObject({
      code: "PROVIDER_RESULT_INVALID",
      providerEvidence: { code: "OPENAI_IMAGE_OUTPUT_MISSING" },
    });

    const rejected = new OpenAiCreativeImageGenerationAdapter({
      images: {
        edit: async () => {
          const error = Object.assign(new Error("Rejected Bearer secret-token sk-sensitive"), {
            status: 400,
            code: "content_policy",
            type: "BadRequest",
            request_id: "trace-1",
          });
          throw error;
        },
      },
    } as never);
    const result = await rejected.generate(genericInput()).catch((error: unknown) => error);
    expect(result).toBeInstanceOf(CreativeImageAdapterError);
    expect(result).toMatchObject({ code: "PROVIDER_REJECTED", providerEvidence: { status: 400, requestId: "trace-1" } });
    expect(JSON.stringify(result)).not.toContain("secret-token");
    expect(JSON.stringify(result)).not.toContain("sk-sensitive");
  });

  it("preserves the AI Story compatibility input, idempotency, and output shape", async () => {
    let sharedInput: Record<string, unknown> | undefined;
    const shared = new OpenAiCreativeImageGenerationAdapter(mockClient({
      data: [{ b64_json: PNG.toString("base64"), revised_prompt: "same revised prompt" }],
    }, (_body, options) => { sharedInput = options; }));
    const adapter = new OpenAiSceneKeyframeAdapter(shared);
    const input = {
      brief: {
        SCENE_IDENTITY: {
          tenantId: "tenant-1", workspaceId: "workspace-1", storyId: "story-1", sceneId: "scene-2", sceneVersionId: "scene-2-v1",
        },
      },
      prompt: "Existing narrative prompt",
      references: [{
        reference: {
          assetId: "product-1", contentHash: hash(PNG), mimeType: "image/png", role: "RAW_SUBJECT",
          subjectId: "product", authorityId: "authority-1", authorityClassification: "ACTIVE",
          tenantId: "tenant-1", workspaceId: "workspace-1", storyId: "story-1",
        },
        bytes: PNG,
      }],
      idempotencyKey: "existing-stable-key",
    } as SceneKeyframeGenerationInput;

    const output = await adapter.generate(input);
    expect(sharedInput).toEqual({ maxRetries: 0, headers: { "Idempotency-Key": "existing-stable-key" } });
    expect(output).toEqual({
      bytes: PNG,
      mimeType: "image/png",
      providerRequestId: "openai-image:existing-stable-key",
      revisedPrompt: "same revised prompt",
    });
    expect(adapter.adapterVersion).toBe("openai-scene-keyframe-edit.v1");
  });

  it("keeps narrative QC in AI Story and has exactly one images.edit implementation", async () => {
    expect(OPENAI_SCENE_KEYFRAME_QC_MODEL).toBe("gpt-4o");
    const agentFiles = await sourceFiles(path.resolve("packages/agents/src"));
    const sources = await Promise.all(agentFiles.map(async (file) => ({ file, content: await readFile(file, "utf8") })));
    const editOwners = sources.filter(({ content }) => /\.images\.edit\s*\(/.test(content));
    expect(editOwners.map(({ file }) => path.relative(process.cwd(), file).replaceAll("\\", "/"))).toEqual([
      "packages/agents/src/creative-image/openai-creative-image-adapter.ts",
    ]);
    const aiStorySource = sources
      .filter(({ file }) => file.includes(`${path.sep}ai-story${path.sep}`))
      .map(({ content }) => content)
      .join("\n");
    expect(aiStorySource).not.toMatch(/\.images\.edit\s*\(/);
    expect(aiStorySource).not.toContain("CreativeImageExecutionService");
    expect(aiStorySource).toContain('OPENAI_SCENE_KEYFRAME_QC_MODEL = "gpt-4o"');

    const photoSceneSource = sources
      .filter(({ file }) => file.includes(`${path.sep}photo-scene${path.sep}`))
      .map(({ content }) => content)
      .join("\n");
    expect(photoSceneSource).not.toMatch(/openai-creative-image-adapter|OpenAiCreativeImageGenerationAdapter/);
  });
});
