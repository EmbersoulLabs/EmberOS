/** PD-014 AI Skill / Router shared types. */

export type AiProviderId = "openai" | "gemini" | "claude" | "deepseek" | "local";

export type AiSkillId =
  | "business-profile-analyzer"
  | "campaign-brief-assist"
  | "asset-display-name"
  | "target-audience-suggest";

export interface AiJsonCompletionRequest {
  system: string;
  user: string;
  schemaHint: string;
  /** Soft preference — Router may override. */
  preferredModel?: string;
  temperature?: number;
  timeoutMs?: number;
  /** Router-level retries (failover may consume additional attempts). */
  maxRetries?: number;
}

export interface AiTokenUsage {
  input: number;
  output: number;
  costUsd: number;
}

export interface AiJsonCompletionResult {
  json: Record<string, unknown>;
  usage: AiTokenUsage;
  provider: AiProviderId;
  model: string;
}

export interface AiSkillRetryPolicy {
  maxRetries: number;
}

/**
 * Provider-agnostic AI Skill definition.
 * Skills own prompt + validation + normalization — never provider SDKs.
 */
export interface AiSkill<TInput, TOutput> {
  id: AiSkillId;
  promptVersion: string;
  schemaVersion: string;
  retryPolicy?: AiSkillRetryPolicy;
  validateInput(payload: unknown): TInput;
  buildPrompt(input: TInput): Pick<AiJsonCompletionRequest, "system" | "user" | "schemaHint" | "preferredModel" | "temperature">;
  normalizeOutput(
    raw: Record<string, unknown>,
    input: TInput,
    completion: AiJsonCompletionResult
  ): TOutput;
}

export class AiSkillError extends Error {
  constructor(
    message: string,
    readonly code:
      | "UNKNOWN_SKILL"
      | "INVALID_INPUT"
      | "PROVIDER_UNAVAILABLE"
      | "PROVIDER_FAILED"
      | "NORMALIZE_FAILED",
    readonly cause?: unknown
  ) {
    super(message);
    this.name = "AiSkillError";
  }
}
