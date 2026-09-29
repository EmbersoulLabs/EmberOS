import {
  AI_STORY_CHARACTER_DNA_COPY,
  AiStoryCharacterDnaError,
  CHARACTER_DNA_ANALYSIS,
  type AiStoryCharacterDna,
  type CharacterDnaAnalysisFailureDiagnostic,
} from "@ceo-agent/shared";
import {
  classifyCharacterDnaAnalysisFailure,
  mockCharacterDnaFixture,
  sanitizeCharacterDnaAnalysisOutput,
} from "@ceo-agent/shared/server";
import { callVisionJsonModel } from "../llm";

export const CHARACTER_DNA_VISION_MODEL = "gpt-4o" as const;
export const CHARACTER_DNA_VISION_PROVIDER = "openai-vision" as const;
export const CHARACTER_DNA_VISION_REQUEST_OPTIONS = Object.freeze({
  maxRetries: 0,
});

export type CharacterDnaVisionCaller = <T>(
  system: string,
  userText: string,
  imageDataUrls: string[],
  schemaHint: string,
  requestOptions?: { maxRetries: number }
) => Promise<{
  result: T;
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
  "Return JSON only.",
].join(" ");

const SCHEMA_HINT = `{
  identityDescription, face{shape,jawline,forehead,cheeks,chin},
  eyes{shape,size,colorDescription,eyebrowShape},
  nose{bridge,width,tip}, mouth{lipShape,lipFullness},
  hair{length,texture,parting,style,colorDescription},
  body{build,proportionDescription,heightImpression},
  appearance{defaultExpression,overallImpression,presentationStyle},
  distinctiveVisualFacts, mustPreserve, mutableTraits
}`;

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

function characterDnaVisionFailure(error: unknown): AiStoryCharacterDnaError {
  const providerRequestId = providerTokenFrom(error, "request_id") ?? providerTokenFrom(error, "requestId");
  const providerModelId = providerTokenFrom(error, "model") ?? providerTokenFrom(error, "providerModelId");
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
  };
  return new AiStoryCharacterDnaError(
    diagnostic.failureCode,
    AI_STORY_CHARACTER_DNA_COPY.analysisFailed,
    diagnostic
  );
}

export class VisionCharacterDnaAnalysisProvider implements CharacterDnaAnalysisProvider {
  constructor(
    private readonly callVision: CharacterDnaVisionCaller = callVisionJsonModel
  ) {}

  async analyzeCharacter(request: CharacterDnaAnalysisProviderRequest): Promise<CharacterDnaAnalysisProviderResult> {
    let result: unknown;
    let usage: { input: number; output: number; costUsd: number };
    let providerRequestId: string | null = null;
    let requestedModelId: string | null = CHARACTER_DNA_VISION_MODEL;
    let providerModelId: string | null = null;
    try {
      const response = await this.callVision<unknown>(
        SYSTEM,
        "Analyze only visible appearance in this authorized Character source portrait.",
        [request.imageDataUrl],
        SCHEMA_HINT,
        CHARACTER_DNA_VISION_REQUEST_OPTIONS
      );
      result = response.result;
      usage = response.usage;
      providerRequestId = safeProviderToken(response.providerRequestId);
      requestedModelId = safeProviderToken(response.requestedModelId) ?? CHARACTER_DNA_VISION_MODEL;
      providerModelId = safeProviderToken(response.providerModelId);
    } catch (error) {
      throw characterDnaVisionFailure(error);
    }
    let dna: AiStoryCharacterDna;
    try {
      dna = sanitizeCharacterDnaAnalysisOutput({
        payload: result,
        sourceAssetId: request.sourceAssetId,
        sourceContentHash: request.sourceContentHash,
        createdAt: request.createdAt,
      });
    } catch (error) {
      const classified = classifyCharacterDnaAnalysisFailure(error);
      throw new AiStoryCharacterDnaError(classified.failureCode, AI_STORY_CHARACTER_DNA_COPY.analysisFailed, {
        ...classified,
        providerRequestId: classified.providerRequestId ?? providerRequestId,
        requestedModelId: classified.requestedModelId ?? requestedModelId,
        providerModelId: classified.providerModelId ?? providerModelId,
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
