import OpenAI, { toFile } from "openai";
import type {
  SceneKeyframeGenerationAdapter,
  SceneKeyframeGenerationInput,
  SceneKeyframeGenerationOutput,
  SceneKeyframeQcAdapter,
  SceneKeyframeQcDimension,
  SceneKeyframeQcEvidence,
} from "./scene-keyframe-preparation";
import { SCENE_KEYFRAME_QC_DIMENSIONS } from "./scene-keyframe-preparation";

export const OPENAI_SCENE_KEYFRAME_ADAPTER_VERSION = "openai-scene-keyframe-edit.v1" as const;
export const OPENAI_SCENE_KEYFRAME_MODEL = "gpt-image-2" as const;
export const OPENAI_SCENE_KEYFRAME_QC_MODEL = "gpt-4o" as const;

type OpenAiImagesClient = Pick<OpenAI, "images">;

/**
 * Narrow adapter for reference-conditioned narrative keyframes. Construction is
 * side-effect free; executeSceneKeyframePreparation owns paid-call authorization.
 */
export class OpenAiSceneKeyframeAdapter implements SceneKeyframeGenerationAdapter {
  readonly providerId = "openai";
  readonly modelId = OPENAI_SCENE_KEYFRAME_MODEL;
  readonly adapterVersion = OPENAI_SCENE_KEYFRAME_ADAPTER_VERSION;
  readonly externalPaidCall = true;
  readonly referenceConditioned = true as const;
  readonly narrativeCharacterComposition = true as const;
  readonly possessionComposition = true as const;
  readonly actionStartStateComposition = true as const;

  constructor(private readonly client: OpenAiImagesClient) {}

  async generate(input: SceneKeyframeGenerationInput): Promise<SceneKeyframeGenerationOutput> {
    if (input.references.length === 0) throw new Error("SCENE_KEYFRAME_REFERENCE_REQUIRED");
    const images = await Promise.all(input.references.map(({ reference, bytes }) => {
      const ext = reference.mimeType === "image/jpeg" ? "jpg" : reference.mimeType.split("/")[1] ?? "png";
      return toFile(bytes, `${reference.role.toLowerCase()}-${reference.assetId}.${ext}`, { type: reference.mimeType });
    }));
    const response = await this.client.images.edit({
      model: this.modelId,
      image: images,
      prompt: input.prompt,
      n: 1,
      quality: "high",
      size: "1536x1024",
    }, { maxRetries: 0, headers: { "Idempotency-Key": input.idempotencyKey } });
    const item = response.data?.[0];
    if (!item?.b64_json) throw new Error("SCENE_KEYFRAME_PROVIDER_OUTPUT_MISSING");
    return {
      bytes: Buffer.from(item.b64_json, "base64"),
      mimeType: "image/png",
      providerRequestId: `openai-image:${input.idempotencyKey}`,
      revisedPrompt: item.revised_prompt,
    };
  }
}

function imageDataUrl(bytes: Buffer, mimeType: string): string {
  return `data:${mimeType};base64,${bytes.toString("base64")}`;
}

function parseQcEvidence(value: unknown): SceneKeyframeQcEvidence {
  if (!value || typeof value !== "object") throw new Error("SCENE_KEYFRAME_QC_OUTPUT_INVALID");
  const record = value as Record<string, unknown>;
  const dimensions = (record.dimensions ?? record) as Record<string, unknown>;
  const parsed = {} as Record<SceneKeyframeQcDimension, { verdict: "PASS" | "FAIL" | "UNKNOWN"; note: string }>;
  for (const dimension of SCENE_KEYFRAME_QC_DIMENSIONS) {
    const item = dimensions[dimension];
    if (!item || typeof item !== "object") throw new Error(`SCENE_KEYFRAME_QC_DIMENSION_MISSING:${dimension}`);
    const verdict = (item as { verdict?: unknown }).verdict;
    const note = (item as { note?: unknown }).note;
    if (verdict !== "PASS" && verdict !== "FAIL" && verdict !== "UNKNOWN") {
      throw new Error(`SCENE_KEYFRAME_QC_VERDICT_INVALID:${dimension}`);
    }
    parsed[dimension] = { verdict, note: typeof note === "string" ? note.slice(0, 500) : "No bounded note supplied" };
  }
  return parsed;
}

/** Independent visual QC; generation output never self-promotes. */
export class OpenAiSceneKeyframeQcAdapter implements SceneKeyframeQcAdapter {
  readonly evaluatorId = "openai-scene-keyframe-visual-qc";
  readonly evaluatorVersion = "1.0.0";
  readonly externalPaidCall = true;

  constructor(private readonly client: Pick<OpenAI, "chat">) {}

  async evaluate(input: Parameters<SceneKeyframeQcAdapter["evaluate"]>[0]): Promise<SceneKeyframeQcEvidence> {
    const response = await this.client.chat.completions.create({
      model: OPENAI_SCENE_KEYFRAME_QC_MODEL,
      response_format: { type: "json_object" },
      temperature: 0,
      messages: [{
        role: "system",
        content: "You are a strict narrative keyframe QC evaluator. Judge only visible evidence. Return JSON with a dimensions object containing every requested dimension, each with verdict PASS, FAIL, or UNKNOWN and a short note. Unknown is required when visual proof is insufficient.",
      }, {
        role: "user",
        content: [
          {
            type: "text",
            text: `Evaluate these dimensions: ${SCENE_KEYFRAME_QC_DIMENSIONS.join(", ")}\nAuthority brief:\n${JSON.stringify(input.brief)}`,
          },
          { type: "text", text: "Generated candidate:" },
          { type: "image_url", image_url: { url: imageDataUrl(input.generated.bytes, input.generated.mimeType), detail: "high" } },
          ...input.references.flatMap(({ reference, bytes }) => ([
            { type: "text" as const, text: `Identity reference ${reference.role}:${reference.subjectId} (background/pose is not authority):` },
            { type: "image_url" as const, image_url: { url: imageDataUrl(bytes, reference.mimeType), detail: "high" as const } },
          ])),
        ],
      }],
    }, { maxRetries: 0 });
    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("SCENE_KEYFRAME_QC_OUTPUT_MISSING");
    try {
      return parseQcEvidence(JSON.parse(content));
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error("SCENE_KEYFRAME_QC_OUTPUT_INVALID");
      throw error;
    }
  }
}

export function createOpenAiSceneKeyframeAdapter(env: NodeJS.ProcessEnv = process.env): OpenAiSceneKeyframeAdapter {
  const apiKey = env.AI_PROVIDER_OPENAI_API_KEY?.trim() || env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  return new OpenAiSceneKeyframeAdapter(new OpenAI({ apiKey, maxRetries: 0 }));
}

export function createOpenAiSceneKeyframeRuntime(env: NodeJS.ProcessEnv = process.env): Readonly<{
  generator: OpenAiSceneKeyframeAdapter;
  qcEvaluator: OpenAiSceneKeyframeQcAdapter;
}> {
  const apiKey = env.AI_PROVIDER_OPENAI_API_KEY?.trim() || env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  const client = new OpenAI({ apiKey, maxRetries: 0 });
  return {
    generator: new OpenAiSceneKeyframeAdapter(client),
    qcEvaluator: new OpenAiSceneKeyframeQcAdapter(client),
  };
}
