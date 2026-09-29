import {
  AI_STORY_CHARACTER_DNA_COPY,
  AiStoryCharacterDnaError,
  AiStoryCharacterDnaVisionOutputSchema,
  CHARACTER_DNA_ANALYSIS,
  type AiStoryCharacterDna,
  type CharacterDnaAnalysisFailureDiagnostic,
} from "@ceo-agent/shared";
import {
  characterDnaAnalysisOutputFingerprint,
  classifyCharacterDnaAnalysisFailure,
  mockCharacterDnaFixture,
  sanitizeCharacterDnaAnalysisOutput,
} from "@ceo-agent/shared/server";
import { zodResponseFormat } from "openai/helpers/zod";
import { callVisionStructuredJsonModel } from "../llm";
import type { ZodType } from "zod";

export const CHARACTER_DNA_VISION_MODEL = "gpt-4o" as const;
export const CHARACTER_DNA_VISION_PROVIDER = "openai-vision" as const;
export const CHARACTER_DNA_VISION_REQUEST_OPTIONS = Object.freeze({
  maxRetries: 0,
});

export const CHARACTER_DNA_VISION_SCHEMA_NAME = "ai_story_character_dna_vision_output" as const;

export function characterDnaVisionResponseFormat() {
  return zodResponseFormat(AiStoryCharacterDnaVisionOutputSchema, CHARACTER_DNA_VISION_SCHEMA_NAME);
}

export type CharacterDnaVisionCaller = (input: {
  system: string;
  userText: string;
  imageDataUrls: string[];
  schema: ZodType;
  schemaName: string;
  requestOptions?: { maxRetries: number };
}) => Promise<{
  result: unknown;
  usage: { input: number; output: number; costUsd: number };
  providerRequestId?: string | null;
  requestedModelId?: string | null;
  providerModelId?: string | null;
}>;

export type CharacterDnaAnalysisProviderRequest = {
  sourceAssetId: string;
  sourceContentHash: string;
  imageDataUrl: string;
  createdAt: string;
};

export type CharacterDnaAnalysisProviderResult = {
  dna: AiStoryCharacterDna;
  provider: string;
  providerModel: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: string;
  imageGenerationCalls: 0;
  gptImageCalls: 0;
};

export interface CharacterDnaAnalysisProvider {
  analyzeCharacter(request: CharacterDnaAnalysisProviderRequest): Promise<CharacterDnaAnalysisProviderResult>;
}

const SYSTEM = [
  "You analyze one authorized portrait and return only visible Character DNA.",
  "Describe generation-friendly visual traits: face shape, jawline, eyes, nose, mouth, hair, body proportions, expression.",
  "Do not infer race, ethnicity, religion, nationality, health, medical condition, sexual orientation, political identity, personality, or criminal status.",
  "Do not identify the person. Do not create biometric embeddings, similarity scores, or face-recognition data.",
  "Avoid vague words such as beautiful, attractive, pretty, or handsome.",
  "Every string inside distinctiveVisualFacts, mustPreserve, and mutableTraits must obey the same visual-only restrictions.",
  "distinctiveVisualFacts must be an array of visible facts. Return an empty array when no safely observable distinctive fact exists. Do not invent one.",
  "Return JSON only.",
].join(" ");

const USER_TEXT = "Analyze only visible appearance in this authorized Character source portrait.";

export class MockCharacterDnaAnalysisProvider implements CharacterDnaAnalysisProvider {
  constructor(private readonly mode: "succeed" | "reject" = "succeed") {}

  async analyzeCharacter(request: CharacterDnaAnalysisProviderRequest): Promise<CharacterDnaAnalysisProviderResult> {
    if (this.mode === "reject") {
      throw new AiStoryCharacterDnaError("CHARACTER_DNA_ANALYSIS_INVALID", AI_STORY_CHARACTER_DNA_COPY.analysisFailed);
    }
    return {
      dna: mockCharacterDnaFixture({
        sourceAssetId: request.sourceAssetId,
        sourceContentHash: request.sourceContentHash,
        createdAt: request.createdAt,
      }),
      provider: "mock",
      providerModel: "character-dna-mock.v1",
      inputTokens: 120,
      outputTokens: 80,
      costUsd: "0.0010",
      imageGenerationCalls: 0,
      gptImageCalls: 0,
    };
  }
}

const SAFE_PROVIDER_TOKEN = /^[A-Za-z0-9._:-]{1,120}$/;

function safeProviderToken(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return SAFE_PROVIDER_TOKEN.test(trimmed) ? trimmed : null;
}

function providerTokenFrom(error: unknown, key: string) {
  if (!error || typeof error !== "object") return null;
  return safeProviderToken((error as Record<string, unknown>)[key]);
}

function safeUsageFrom(error: unknown) {
  if (!error || typeof error !== "object" || !("usage" in error)) return null;
  const usage = (error as { usage?: { input?: unknown; output?: unknown; costUsd?: unknown } }).usage;
  if (!usage || typeof usage.input !== "number" || typeof usage.output !== "number" || typeof usage.costUsd !== "number") {
    return null;
  }
  return {
    inputTokens: usage.input,
    outputTokens: usage.output,
    costUsd: usage.costUsd.toFixed(4),
  };
}

function characterDnaVisionFailure(error: unknown): AiStoryCharacterDnaError {
  const providerRequestId = providerTokenFrom(error, "request_id") ?? providerTokenFrom(error, "requestId");
  const providerModelId = providerTokenFrom(error, "model") ?? providerTokenFrom(error, "providerModelId");
  const usage = safeUsageFrom(error);
  const classified = classifyCharacterDnaAnalysisFailure(
    error instanceof SyntaxError
      ? error
      : new AiStoryCharacterDnaError(
        "CHARACTER_DNA_PROVIDER_CALL_FAILED",
        AI_STORY_CHARACTER_DNA_COPY.analysisFailed
      )
  );
  const diagnostic: CharacterDnaAnalysisFailureDiagnostic = {
    ...classified,
    providerRequestId,
    requestedModelId: CHARACTER_DNA_VISION_MODEL,
    providerModelId,
    provider: usage ? CHARACTER_DNA_VISION_PROVIDER : null,
    providerModel: usage ? (providerModelId ?? CHARACTER_DNA_VISION_MODEL) : null,
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
    costUsd: usage?.costUsd ?? null,
  };
  return new AiStoryCharacterDnaError(
    diagnostic.failureCode,
    AI_STORY_CHARACTER_DNA_COPY.analysisFailed,
    diagnostic
  );
}

function postProviderValidationFailure(input: {
  error: unknown;
  payload: unknown;
  usage: { input: number; output: number; costUsd: number };
  providerRequestId: string | null;
  requestedModelId: string | null;
  providerModelId: string | null;
}) {
  const classified = classifyCharacterDnaAnalysisFailure(input.error);
  return new AiStoryCharacterDnaError(classified.failureCode, AI_STORY_CHARACTER_DNA_COPY.analysisFailed, {
    ...classified,
    provider: CHARACTER_DNA_VISION_PROVIDER,
    providerModel: input.providerModelId ?? CHARACTER_DNA_VISION_MODEL,
    providerRequestId: classified.providerRequestId ?? input.providerRequestId,
    requestedModelId: classified.requestedModelId ?? input.requestedModelId,
    providerModelId: classified.providerModelId ?? input.providerModelId,
    inputTokens: input.usage.input,
    outputTokens: input.usage.output,
    costUsd: input.usage.costUsd.toFixed(4),
    outputFingerprint: classified.outputFingerprint ?? characterDnaAnalysisOutputFingerprint(input.payload),
  });
}

export class VisionCharacterDnaAnalysisProvider implements CharacterDnaAnalysisProvider {
  constructor(
    private readonly callVision: CharacterDnaVisionCaller = callVisionStructuredJsonModel
  ) {}

  async analyzeCharacter(request: CharacterDnaAnalysisProviderRequest): Promise<CharacterDnaAnalysisProviderResult> {
    let result: unknown;
    let usage: { input: number; output: number; costUsd: number };
    let providerRequestId: string | null = null;
    let requestedModelId: string | null = CHARACTER_DNA_VISION_MODEL;
    let providerModelId: string | null = null;
    try {
      const response = await this.callVision({
        system: SYSTEM,
        userText: USER_TEXT,
        imageDataUrls: [request.imageDataUrl],
        schema: AiStoryCharacterDnaVisionOutputSchema,
        schemaName: CHARACTER_DNA_VISION_SCHEMA_NAME,
        requestOptions: CHARACTER_DNA_VISION_REQUEST_OPTIONS,
      });
      result = response.result;
      usage = response.usage;
      providerRequestId = safeProviderToken(response.providerRequestId);
      requestedModelId = safeProviderToken(response.requestedModelId) ?? CHARACTER_DNA_VISION_MODEL;
      providerModelId = safeProviderToken(response.providerModelId);
    } catch (error) {
      throw characterDnaVisionFailure(error);
    }
    const structural = AiStoryCharacterDnaVisionOutputSchema.safeParse(result);
    if (!structural.success) {
      throw postProviderValidationFailure({
        error: structural.error,
        payload: result,
        usage,
        providerRequestId,
        requestedModelId,
        providerModelId,
      });
    }
    let dna: AiStoryCharacterDna;
    try {
      dna = sanitizeCharacterDnaAnalysisOutput({
        payload: structural.data,
        sourceAssetId: request.sourceAssetId,
        sourceContentHash: request.sourceContentHash,
        createdAt: request.createdAt,
      });
    } catch (error) {
      throw postProviderValidationFailure({
        error,
        payload: structural.data,
        usage,
        providerRequestId,
        requestedModelId,
        providerModelId,
      });
    }
    return {
      dna,
      provider: CHARACTER_DNA_VISION_PROVIDER,
      providerModel: CHARACTER_DNA_VISION_MODEL,
      inputTokens: usage.input,
      outputTokens: usage.output,
      costUsd: usage.costUsd.toFixed(4),
      imageGenerationCalls: 0,
      gptImageCalls: 0,
    };
  }
}

export function resolveCharacterDnaAnalysisProvider(
  env: NodeJS.ProcessEnv = process.env
): CharacterDnaAnalysisProvider {
  const raw = (env.CHARACTER_DNA_ANALYSIS_PROVIDER ?? "mock").trim().toLowerCase();
  if (raw === "vision") return new VisionCharacterDnaAnalysisProvider();
  return new MockCharacterDnaAnalysisProvider();
}

export function assertNoImageGenerationForCharacterDna(result: CharacterDnaAnalysisProviderResult) {
  if (result.imageGenerationCalls !== 0 || result.gptImageCalls !== 0) {
    throw new AiStoryCharacterDnaError(
      "CHARACTER_DNA_IMAGE_GENERATION_BLOCKED",
      "Character DNA analysis cannot call image generation."
    );
  }
  if (result.provider.includes("gpt-image") || result.providerModel.includes("gpt-image")) {
    throw new AiStoryCharacterDnaError(
      "CHARACTER_DNA_IMAGE_GENERATION_BLOCKED",
      "Character DNA analysis cannot call gpt-image."
    );
  }
}

export { CHARACTER_DNA_ANALYSIS };
