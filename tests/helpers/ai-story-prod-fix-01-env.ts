import { resetAiProviderConfigCache } from "@ceo-agent/shared";

/** Dummy routing-only config. Does not perform provider HTTP. */
export function applyProductionLikeVideoRoutingEnv(
  env: NodeJS.ProcessEnv = process.env
): void {
  env.AI_PROVIDER_ROUTING_MODE = "fixed";
  env.AI_DEFAULT_TEXT_PROVIDER = env.AI_DEFAULT_TEXT_PROVIDER || "openai";
  env.AI_DEFAULT_VIDEO_PROVIDER = "seedance";
  env.AI_DEFAULT_UPSCALE_PROVIDER = env.AI_DEFAULT_UPSCALE_PROVIDER || "fal";
  env.AI_PROVIDER_SEEDANCE_ENABLED = "true";
  env.AI_PROVIDER_SEEDANCE_API_KEY =
    env.AI_PROVIDER_SEEDANCE_API_KEY || "test-seedance-not-used";
  env.AI_PROVIDER_SEEDANCE_BASE_URL =
    env.AI_PROVIDER_SEEDANCE_BASE_URL || "https://ark.example.invalid";
  env.AI_PROVIDER_SEEDANCE_DEFAULT_MODEL =
    env.AI_PROVIDER_SEEDANCE_DEFAULT_MODEL || "dreamina-seedance-2-0-260128";
  env.AI_PROVIDER_MINIMAX_ENABLED = "false";
  resetAiProviderConfigCache();
}
