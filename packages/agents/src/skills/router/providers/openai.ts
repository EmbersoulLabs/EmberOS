import { callJsonModel } from "../../../llm";
import type {
  AiJsonCompletionRequest,
  AiJsonCompletionResult,
  AiProviderId,
} from "../../types";
import { AiSkillError } from "../../types";
import { OPENAI_EFFICIENT_MODEL, isOpenAiTextModel, type OpenAiTextModel } from "../../../openai-model-policy";

function resolveOpenAiModel(preferred?: string): OpenAiTextModel {
  if (preferred && isOpenAiTextModel(preferred)) return preferred;
  return OPENAI_EFFICIENT_MODEL;
}

/** OpenAI JSON completion — provider logic terminates here (PD-014). */
export async function invokeOpenAiJsonCompletion(
  request: AiJsonCompletionRequest
): Promise<AiJsonCompletionResult> {
  try {
    const model = resolveOpenAiModel(request.preferredModel);
    const { result, usage } = await callJsonModel<Record<string, unknown>>(
      request.system,
      request.user,
      request.schemaHint,
      { model }
    );
    return {
      json: result && typeof result === "object" ? result : {},
      usage,
      provider: "openai",
      model,
    };
  } catch (error) {
    const message = (error as Error).message ?? "OpenAI completion failed";
    if (/OPENAI_API_KEY/i.test(message)) {
      throw new AiSkillError(message, "PROVIDER_UNAVAILABLE", error);
    }
    throw new AiSkillError(message, "PROVIDER_FAILED", error);
  }
}

/** Reserved for future providers — API stable, implementation TBD. */
export async function invokeUnsupportedProvider(
  provider: AiProviderId
): Promise<never> {
  throw new AiSkillError(
    `AI provider "${provider}" is not configured yet`,
    "PROVIDER_UNAVAILABLE"
  );
}
