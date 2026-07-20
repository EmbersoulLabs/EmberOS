import type { AiJsonCompletionRequest, AiJsonCompletionResult, AiProviderId } from "../types";
import { AiSkillError } from "../types";
import { invokeOpenAiJsonCompletion, invokeUnsupportedProvider } from "./providers/openai";

export interface AiRouterSelection {
  provider: AiProviderId;
  model: string;
  timeoutMs: number;
  maxRetries: number;
}

export interface AiRouterOptions {
  /** Force a provider for tests / future workspace prefs. */
  provider?: AiProviderId;
  preferredModel?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_RETRIES = 1;

/**
 * Select provider + model. Today only OpenAI is wired; API already allows others.
 */
export function selectAiRoute(
  request: AiJsonCompletionRequest,
  options: AiRouterOptions = {}
): AiRouterSelection {
  const provider: AiProviderId = options.provider ?? "openai";
  const preferredModel = options.preferredModel ?? request.preferredModel ?? "gpt-4o-mini";
  const model =
    provider === "openai"
      ? preferredModel === "gpt-4o"
        ? "gpt-4o"
        : "gpt-4o-mini"
      : preferredModel;

  return {
    provider,
    model,
    timeoutMs: options.timeoutMs ?? request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxRetries: options.maxRetries ?? request.maxRetries ?? DEFAULT_RETRIES,
  };
}

async function invokeProvider(
  provider: AiProviderId,
  request: AiJsonCompletionRequest
): Promise<AiJsonCompletionResult> {
  switch (provider) {
    case "openai":
      return invokeOpenAiJsonCompletion(request);
    case "gemini":
    case "claude":
    case "deepseek":
    case "local":
      return invokeUnsupportedProvider(provider);
    default: {
      const _exhaustive: never = provider;
      return invokeUnsupportedProvider(_exhaustive);
    }
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new AiSkillError(`AI Router timed out after ${timeoutMs}ms`, "PROVIDER_FAILED"));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/**
 * AI Router — owns provider selection, model, timeout, retry, and future failover.
 * Business modules and Skills must not call providers directly.
 */
export async function routeJsonCompletion(
  request: AiJsonCompletionRequest,
  options: AiRouterOptions = {}
): Promise<AiJsonCompletionResult> {
  const route = selectAiRoute(request, options);
  const routedRequest: AiJsonCompletionRequest = {
    ...request,
    preferredModel: route.model,
  };

  // Future: ordered failover list. For now a single selected provider with retries.
  const providers: AiProviderId[] = [route.provider];
  let lastError: unknown;

  for (const provider of providers) {
    for (let attempt = 0; attempt <= route.maxRetries; attempt++) {
      try {
        return await withTimeout(invokeProvider(provider, routedRequest), route.timeoutMs);
      } catch (error) {
        lastError = error;
        if (
          error instanceof AiSkillError &&
          error.code === "PROVIDER_UNAVAILABLE" &&
          providers.length === 1
        ) {
          throw error;
        }
      }
    }
  }

  if (lastError instanceof AiSkillError) throw lastError;
  throw new AiSkillError(
    (lastError as Error)?.message ?? "AI Router failed",
    "PROVIDER_FAILED",
    lastError
  );
}
