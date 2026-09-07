import OpenAI from "openai";
import {
  CREATIVE_IMAGE_EXECUTION_CONTRACT_VERSION,
  CreativeImageAdapterError,
  CreativeImageExecutionService,
  OPENAI_CREATIVE_IMAGE_ADAPTER_VERSION,
  OpenAiCreativeImageGenerationAdapter,
  createOpenAiCreativeImageGenerationAdapter,
  type OpenAiImagesClient,
} from "../creative-image";
import type {
  SceneKeyframeGenerationAdapter,
  SceneKeyframeGenerationCapabilityProfile,
  SceneKeyframeGenerationInput,
  SceneKeyframeGenerationOutput,
  SceneKeyframeQcAdapter,
  SceneKeyframeQcDimension,
  SceneKeyframeQcEvidence,
} from "./scene-keyframe-preparation";
import { SCENE_KEYFRAME_QC_DIMENSIONS } from "./scene-keyframe-preparation";

/** Temporary compatibility alias; canonical generation adapter version is shared-owned. */
export const OPENAI_SCENE_KEYFRAME_ADAPTER_VERSION = OPENAI_CREATIVE_IMAGE_ADAPTER_VERSION;
export const OPENAI_SCENE_KEYFRAME_QC_MODEL = "gpt-4o" as const;

/**
 * Narrow adapter for reference-conditioned narrative keyframes. Construction is
 * side-effect free; executeSceneKeyframePreparation owns paid-call authorization.
 */
export class OpenAiSceneKeyframeAdapter implements SceneKeyframeGenerationAdapter {
  readonly providerId = "openai";
  readonly modelId: OpenAiCreativeImageGenerationAdapter["modelId"];
  readonly adapterVersion = OPENAI_SCENE_KEYFRAME_ADAPTER_VERSION;
  readonly externalPaidCall = true;
  readonly referenceConditioned = true as const;
  readonly narrativeCharacterComposition = true as const;
  readonly possessionComposition = true as const;
  readonly actionStartStateComposition = true as const;

  private readonly adapter: OpenAiCreativeImageGenerationAdapter;

  constructor(adapterOrClient: OpenAiCreativeImageGenerationAdapter | OpenAiImagesClient) {
    this.adapter = adapterOrClient instanceof OpenAiCreativeImageGenerationAdapter
      ? adapterOrClient
      : new OpenAiCreativeImageGenerationAdapter(adapterOrClient);
    this.modelId = this.adapter.modelId;
  }

  async generate(input: SceneKeyframeGenerationInput): Promise<SceneKeyframeGenerationOutput> {
    if (input.references.length === 0) throw new Error("SCENE_KEYFRAME_REFERENCE_REQUIRED");
    try {
      const output = await this.adapter.generate({
        contractVersion: CREATIVE_IMAGE_EXECUTION_CONTRACT_VERSION,
        scope: {
          tenantId: input.brief.SCENE_IDENTITY.tenantId,
          workspaceId: input.brief.SCENE_IDENTITY.workspaceId,
          correlationId: `${input.brief.SCENE_IDENTITY.storyId}:${input.brief.SCENE_IDENTITY.sceneId}`,
        },
        executionIdentity: input.idempotencyKey,
        idempotencyKey: input.idempotencyKey,
        authorizationId: `ai-story-keyframe-compatibility:${input.idempotencyKey}`,
        prompt: input.prompt,
        references: input.references.map(({ reference, bytes }) => ({
          assetId: reference.assetId,
          contentHash: reference.contentHash,
          mimeType: reference.mimeType,
          bytes,
          role: reference.role === "RAW_SUBJECT" ? "INPUT_IMAGE" : "REFERENCE_IMAGE",
        })),
        requestedOutput: {
          mimeType: "image/png",
          width: 1536,
          height: 1024,
          sizeConstraint: "1536x1024",
          quality: "HIGH",
        },
        correlationMetadata: {
          compatibilityBoundary: "ai-story-scene-keyframe",
          storyId: input.brief.SCENE_IDENTITY.storyId,
          sceneId: input.brief.SCENE_IDENTITY.sceneId,
          sceneVersionId: input.brief.SCENE_IDENTITY.sceneVersionId,
        },
      });
      return {
        bytes: output.bytes,
        mimeType: output.mimeType,
        providerRequestId: output.providerRequestId,
        ...(output.revisedPrompt ? { revisedPrompt: output.revisedPrompt } : {}),
      };
    } catch (error) {
      if (error instanceof CreativeImageAdapterError) {
        if (error.providerEvidence?.code === "OPENAI_IMAGE_REFERENCE_REQUIRED") {
          throw new Error("SCENE_KEYFRAME_REFERENCE_REQUIRED");
        }
        if (error.providerEvidence?.code === "OPENAI_IMAGE_OUTPUT_MISSING") {
          throw new Error("SCENE_KEYFRAME_PROVIDER_OUTPUT_MISSING");
        }
      }
      throw error;
    }
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
  return new OpenAiSceneKeyframeAdapter(createOpenAiCreativeImageGenerationAdapter(env));
}

export function createOpenAiSceneKeyframeRuntime(env: NodeJS.ProcessEnv = process.env): Readonly<{
  generationCapability: SceneKeyframeGenerationCapabilityProfile;
  creativeImageExecutionService: CreativeImageExecutionService;
  qcEvaluator: OpenAiSceneKeyframeQcAdapter;
}> {
  const apiKey = env.AI_PROVIDER_OPENAI_API_KEY?.trim() || env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  const client = new OpenAI({ apiKey, maxRetries: 0 });
  const adapter = createOpenAiCreativeImageGenerationAdapter(env);
  return {
    generationCapability: {
      providerId: adapter.providerId,
      modelId: adapter.modelId,
      adapterVersion: adapter.adapterVersion,
      externalPaidCall: adapter.externalPaidCall,
      referenceConditioned: true,
      narrativeCharacterComposition: true,
      possessionComposition: true,
      actionStartStateComposition: true,
    },
    creativeImageExecutionService: new CreativeImageExecutionService({ adapter }),
    qcEvaluator: new OpenAiSceneKeyframeQcAdapter(client),
  };
}
