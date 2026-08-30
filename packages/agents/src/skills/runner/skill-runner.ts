import type { AiSkill, AiSkillId } from "../types";
import { AiSkillError } from "../types";
import { routeJsonCompletion, type AiRouterOptions } from "../router/ai-router";
import type { AiJsonCompletionRequest, AiJsonCompletionResult } from "../types";
import {
  BusinessProfileAnalyzerSkill,
  BUSINESS_PROFILE_ANALYZER_SKILL_ID,
  type BusinessProfileAnalyzerSkillResult,
} from "../business-profile-analyzer/skill";

type AnySkill = AiSkill<unknown, unknown>;

const skillRegistry = new Map<AiSkillId, AnySkill>();

function ensureDefaultsRegistered() {
  if (!skillRegistry.has(BUSINESS_PROFILE_ANALYZER_SKILL_ID)) {
    skillRegistry.set(
      BUSINESS_PROFILE_ANALYZER_SKILL_ID,
      BusinessProfileAnalyzerSkill as AnySkill
    );
  }
}

/** Register or replace a skill (tests / future dynamic loading). */
export function registerAiSkill(skill: AnySkill): void {
  skillRegistry.set(skill.id, skill);
}

export function getRegisteredAiSkill(skillId: AiSkillId): AnySkill | undefined {
  ensureDefaultsRegistered();
  return skillRegistry.get(skillId);
}

export type ExecuteSkillResultMap = {
  "business-profile-analyzer": BusinessProfileAnalyzerSkillResult;
};

export interface ExecuteSkillDeps {
  /** Injectable for tests — production uses AI Router. */
  routeJsonCompletion?: (
    request: AiJsonCompletionRequest,
    options?: AiRouterOptions
  ) => Promise<AiJsonCompletionResult>;
}

/**
 * AI Skill Runner — owns execution lifecycle and Router invocation.
 * Business modules call this instead of providers or prompts.
 */
export async function executeSkill<K extends keyof ExecuteSkillResultMap>(
  skillId: K,
  payload: unknown,
  deps: ExecuteSkillDeps = {}
): Promise<ExecuteSkillResultMap[K]> {
  ensureDefaultsRegistered();
  const skill = skillRegistry.get(skillId as AiSkillId);
  if (!skill) {
    throw new AiSkillError(`Unknown AI Skill: ${skillId}`, "UNKNOWN_SKILL");
  }

  let input: unknown;
  try {
    input = skill.validateInput(payload);
  } catch (error) {
    if (error instanceof AiSkillError) throw error;
    throw new AiSkillError(
      (error as Error).message ?? "Invalid skill input",
      "INVALID_INPUT",
      error
    );
  }

  const prompt = skill.buildPrompt(input);
  const maxRetries = skill.retryPolicy?.maxRetries ?? 0;
  const route = deps.routeJsonCompletion ?? routeJsonCompletion;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Router owns provider retries; skill-level retry covers normalize / transient failures.
      const completion = await route({
        system: prompt.system,
        user: prompt.user,
        schemaHint: prompt.schemaHint,
        preferredModel: prompt.preferredModel,
        temperature: prompt.temperature,
        maxRetries: 0,
      });
      return skill.normalizeOutput(completion.json, input, completion) as ExecuteSkillResultMap[K];
    } catch (error) {
      lastError = error;
      if (error instanceof AiSkillError && error.code === "PROVIDER_UNAVAILABLE") {
        throw error;
      }
      if (error instanceof AiSkillError && error.code === "INVALID_INPUT") {
        throw error;
      }
    }
  }

  if (lastError instanceof AiSkillError) throw lastError;
  throw new AiSkillError(
    (lastError as Error)?.message ?? "AI Skill execution failed",
    "PROVIDER_FAILED",
    lastError
  );
}
