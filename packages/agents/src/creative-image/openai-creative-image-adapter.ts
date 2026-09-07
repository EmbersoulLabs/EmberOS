import OpenAI, { toFile } from "openai";
import {
  CreativeImageAdapterError,
  type CreativeImageBoundedProviderEvidence,
  type CreativeImageGenerationAdapter,
  type CreativeImageGenerationInput,
  type CreativeImageGenerationOutput,
} from "./contracts";

export const OPENAI_CREATIVE_IMAGE_MODEL = "gpt-image-2" as const;

/** Kept stable so the ownership move does not change existing generation identity. */
export const OPENAI_CREATIVE_IMAGE_ADAPTER_VERSION = "openai-scene-keyframe-edit.v1" as const;

export type OpenAiImagesClient = Pick<OpenAI, "images">;

const OPENAI_IMAGE_SIZES = new Set(["1024x1024", "1536x1024", "1024x1536", "auto"]);

function sanitize(value: string | undefined, max: number): string | undefined {
  if (!value) return undefined;
  return value
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, "[REDACTED]")
    .replace(/([?&](?:token|signature|sig|key|credential)=)[^&\s]+/gi, "$1[REDACTED]")
    .slice(0, max);
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  return typeof record[key] === "string" ? record[key] : undefined;
}

function providerFailure(error: unknown): CreativeImageAdapterError {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const status = typeof record.status === "number" ? record.status : undefined;
  const nativeType = stringField(record, "type") ?? (error instanceof Error ? error.name : undefined);
  const evidence: CreativeImageBoundedProviderEvidence = {
    ...(status !== undefined ? { status } : {}),
    ...(sanitize(stringField(record, "code"), 120) ? { code: sanitize(stringField(record, "code"), 120) } : {}),
    ...(sanitize(nativeType, 120)
      ? { type: sanitize(nativeType, 120) }
      : {}),
    ...(sanitize(error instanceof Error ? error.message : undefined, 500)
      ? { message: sanitize(error instanceof Error ? error.message : undefined, 500) }
      : {}),
    ...(sanitize(stringField(record, "request_id") ?? stringField(record, "requestId"), 200)
      ? { requestId: sanitize(stringField(record, "request_id") ?? stringField(record, "requestId"), 200) }
      : {}),
  };
  const code = status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 409 && status !== 429
    ? "PROVIDER_REJECTED"
    : "PROVIDER_UNAVAILABLE";
  return new CreativeImageAdapterError(code, `OpenAI image Provider ${code === "PROVIDER_REJECTED" ? "rejected the request" : "is unavailable"}`, evidence);
}

function outputSize(input: CreativeImageGenerationInput): "1024x1024" | "1536x1024" | "1024x1536" | "auto" {
  const requested = input.requestedOutput.sizeConstraint
    ?? (input.requestedOutput.width && input.requestedOutput.height
      ? `${input.requestedOutput.width}x${input.requestedOutput.height}`
      : "auto");
  if (!OPENAI_IMAGE_SIZES.has(requested)) {
    throw new CreativeImageAdapterError(
      "PROVIDER_RESULT_INVALID",
      "Requested Creative Image size is unsupported",
      { code: "OPENAI_IMAGE_SIZE_UNSUPPORTED" }
    );
  }
  return requested as "1024x1024" | "1536x1024" | "1024x1536" | "auto";
}

function referenceFilename(reference: CreativeImageGenerationInput["references"][number], index: number): string {
  const extension = reference.mimeType === "image/jpeg" ? "jpg" : reference.mimeType.split("/")[1] ?? "bin";
  return `${reference.role.toLowerCase()}-${index + 1}-${reference.assetId}.${extension}`;
}

/** Canonical OpenAI image-edit Provider implementation for shared Creative Image execution. */
export class OpenAiCreativeImageGenerationAdapter implements CreativeImageGenerationAdapter {
  readonly providerId = "openai";
  readonly modelId = OPENAI_CREATIVE_IMAGE_MODEL;
  readonly adapterVersion = OPENAI_CREATIVE_IMAGE_ADAPTER_VERSION;
  readonly externalPaidCall = true;

  constructor(private readonly client: OpenAiImagesClient) {}

  async generate(input: CreativeImageGenerationInput): Promise<CreativeImageGenerationOutput> {
    if (input.references.length === 0) {
      throw new CreativeImageAdapterError(
        "PROVIDER_RESULT_INVALID",
        "OpenAI image editing requires at least one reference",
        { code: "OPENAI_IMAGE_REFERENCE_REQUIRED" }
      );
    }
    if (!input.prompt.trim() || input.references.some((reference) =>
      reference.bytes.length === 0 || !/^image\/(png|jpeg|webp)$/.test(reference.mimeType)
    )) {
      throw new CreativeImageAdapterError(
        "PROVIDER_RESULT_INVALID",
        "OpenAI image generation input is invalid",
        { code: "OPENAI_IMAGE_INPUT_INVALID" }
      );
    }

    const images = await Promise.all(input.references.map((reference, index) =>
      toFile(reference.bytes, referenceFilename(reference, index), { type: reference.mimeType })
    ));

    try {
      const response = await this.client.images.edit({
        model: this.modelId,
        image: images,
        prompt: input.prompt,
        n: 1,
        quality: input.requestedOutput.quality === "HIGH" ? "high" : "medium",
        size: outputSize(input),
      }, {
        maxRetries: 0,
        headers: { "Idempotency-Key": input.idempotencyKey },
      });
      const item = response.data?.[0];
      if (!item?.b64_json) {
        throw new CreativeImageAdapterError(
          "PROVIDER_RESULT_INVALID",
          "OpenAI image Provider output is missing",
          { code: "OPENAI_IMAGE_OUTPUT_MISSING" }
        );
      }
      if (item.b64_json.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(item.b64_json)) {
        throw new CreativeImageAdapterError(
          "PROVIDER_RESULT_INVALID",
          "OpenAI image Provider output is invalid",
          { code: "OPENAI_IMAGE_OUTPUT_INVALID" }
        );
      }
      const providerRequestId = sanitize(
        stringField(response as unknown as Record<string, unknown>, "_request_id"),
        200
      ) ?? `openai-image:${input.idempotencyKey}`;
      const usage = response.usage
        ? { inputUnits: response.usage.input_tokens, outputUnits: response.usage.output_tokens }
        : undefined;
      const bytes = Buffer.from(item.b64_json, "base64");
      if (bytes.length === 0) {
        throw new CreativeImageAdapterError(
          "PROVIDER_RESULT_INVALID",
          "OpenAI image Provider output is invalid",
          { code: "OPENAI_IMAGE_OUTPUT_INVALID" }
        );
      }
      return {
        bytes,
        mimeType: "image/png",
        providerId: this.providerId,
        modelId: this.modelId,
        adapterVersion: this.adapterVersion,
        providerRequestId,
        ...(item.revised_prompt ? { revisedPrompt: item.revised_prompt } : {}),
        ...(usage ? { usage } : {}),
        metadata: { operation: "images.edit", retries: 0 },
      };
    } catch (error) {
      if (error instanceof CreativeImageAdapterError) throw error;
      throw providerFailure(error);
    }
  }
}

export function createOpenAiCreativeImageGenerationAdapter(
  env: NodeJS.ProcessEnv = process.env
): OpenAiCreativeImageGenerationAdapter {
  const apiKey = env.AI_PROVIDER_OPENAI_API_KEY?.trim() || env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  return new OpenAiCreativeImageGenerationAdapter(new OpenAI({ apiKey, maxRetries: 0 }));
}
