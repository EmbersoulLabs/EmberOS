import { afterEach, describe, expect, it } from "vitest";
import {
  AiProviderConfigError,
  getAiProviderConfig,
  isAiProviderReady,
  loadAiProviderConfigFromEnv,
  redactAiProviderConfig,
  resetAiProviderConfigCache,
  validateAiProviderConfig,
  type AiProviderConfig,
} from "@ceo-agent/shared";

afterEach(() => {
  resetAiProviderConfigCache();
});

function baseEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    AI_PROVIDER_ROUTING_MODE: "fixed",
    AI_DEFAULT_TEXT_PROVIDER: "openai",
    AI_DEFAULT_VIDEO_PROVIDER: "seedance",
    AI_DEFAULT_UPSCALE_PROVIDER: "fal",
    AI_COST_TRACKING_ENABLED: "true",
    AI_USAGE_LOG_ENABLED: "true",
    AI_PROVIDER_TIMEOUT_MS: "600000",
    AI_PROVIDER_MAX_RETRIES: "3",
    AI_PROVIDER_OPENAI_ENABLED: "false",
    AI_PROVIDER_SEEDANCE_ENABLED: "false",
    AI_PROVIDER_MINIMAX_ENABLED: "false",
    AI_PROVIDER_FAL_ENABLED: "false",
    ...overrides,
  };
}

describe("AI Provider Environment Foundation", () => {
  it("allows all providers disabled with missing secrets", () => {
    const config = loadAiProviderConfigFromEnv(
      baseEnv({
        AI_PROVIDER_OPENAI_API_KEY: undefined,
        AI_PROVIDER_SEEDANCE_API_KEY: undefined,
        AI_PROVIDER_MINIMAX_API_KEY: undefined,
        AI_PROVIDER_FAL_API_KEY: undefined,
        AI_PROVIDER_MINIMAX_BASE_URL: undefined,
        AI_PROVIDER_MINIMAX_DEFAULT_MODEL: undefined,
      })
    );
    expect(config.providers.openai.enabled).toBe(false);
    expect(config.providers.seedance.enabled).toBe(false);
    expect(config.providers.minimax.enabled).toBe(false);
    expect(config.providers.fal.enabled).toBe(false);
    expect(config.providers.openai.apiKey).toBeNull();
    expect(isAiProviderReady(config, "openai")).toBe(false);
  });

  it("accepts enabled providers with required fields", () => {
    const config = loadAiProviderConfigFromEnv(
      baseEnv({
        AI_PROVIDER_OPENAI_ENABLED: "true",
        AI_PROVIDER_OPENAI_API_KEY: "sk-test-openai",
        AI_PROVIDER_OPENAI_BASE_URL: "https://api.openai.com/v1",
        AI_PROVIDER_OPENAI_DEFAULT_MODEL: "gpt-5.5",
        AI_PROVIDER_SEEDANCE_ENABLED: "true",
        AI_PROVIDER_SEEDANCE_API_KEY: "seedance-key",
        AI_PROVIDER_SEEDANCE_BASE_URL: "https://ark.ap-southeast.bytepluses.com",
        AI_PROVIDER_SEEDANCE_DEFAULT_MODEL: "dreamina-seedance-2-0-260128",
        AI_PROVIDER_MINIMAX_ENABLED: "true",
        AI_PROVIDER_MINIMAX_API_KEY: "minimax-key",
        AI_PROVIDER_MINIMAX_BASE_URL: "https://api.minimax.example/v1",
        AI_PROVIDER_MINIMAX_DEFAULT_MODEL: "minimax-video-01",
        AI_PROVIDER_FAL_ENABLED: "true",
        AI_PROVIDER_FAL_API_KEY: "fal-key",
        AI_PROVIDER_FAL_BASE_URL: "https://queue.fal.run",
        AI_PROVIDER_FAL_DEFAULT_MODEL: "fal-ai/topaz/upscale/video",
      })
    );
    expect(isAiProviderReady(config, "openai")).toBe(true);
    expect(isAiProviderReady(config, "seedance")).toBe(true);
    expect(isAiProviderReady(config, "minimax")).toBe(true);
    expect(isAiProviderReady(config, "fal")).toBe(true);
    expect(config.defaults).toEqual({
      text: "openai",
      video: "seedance",
      upscale: "fal",
    });
  });

  it("fails when an enabled provider is missing an API key", () => {
    expect(() =>
      loadAiProviderConfigFromEnv(
        baseEnv({
          AI_PROVIDER_OPENAI_ENABLED: "true",
          AI_PROVIDER_OPENAI_API_KEY: "",
          AI_PROVIDER_OPENAI_BASE_URL: "https://api.openai.com/v1",
          AI_PROVIDER_OPENAI_DEFAULT_MODEL: "gpt-5.5",
        })
      )
    ).toThrow(AiProviderConfigError);
  });

  it("fails when an enabled provider is missing base URL or default model", () => {
    expect(() =>
      loadAiProviderConfigFromEnv(
        baseEnv({
          AI_PROVIDER_MINIMAX_ENABLED: "true",
          AI_PROVIDER_MINIMAX_API_KEY: "key",
          AI_PROVIDER_MINIMAX_BASE_URL: "",
          AI_PROVIDER_MINIMAX_DEFAULT_MODEL: "",
        })
      )
    ).toThrow(/base URL is required|default model is required/);
  });

  it("fails on invalid routing mode", () => {
    expect(() =>
      loadAiProviderConfigFromEnv(
        baseEnv({
          AI_PROVIDER_ROUTING_MODE: "auction",
        })
      )
    ).toThrow(AiProviderConfigError);
  });

  it("fails on invalid default provider references", () => {
    expect(() =>
      loadAiProviderConfigFromEnv(
        baseEnv({
          AI_DEFAULT_TEXT_PROVIDER: "seedance",
        })
      )
    ).toThrow(AiProviderConfigError);

    expect(() =>
      loadAiProviderConfigFromEnv(
        baseEnv({
          AI_DEFAULT_VIDEO_PROVIDER: "openai",
        })
      )
    ).toThrow(AiProviderConfigError);

    expect(() =>
      loadAiProviderConfigFromEnv(
        baseEnv({
          AI_DEFAULT_UPSCALE_PROVIDER: "minimax",
        })
      )
    ).toThrow(AiProviderConfigError);
  });

  it("fails on invalid timeout or retry count", () => {
    expect(() =>
      loadAiProviderConfigFromEnv(
        baseEnv({
          AI_PROVIDER_TIMEOUT_MS: "0",
        })
      )
    ).toThrow(AiProviderConfigError);

    expect(() =>
      loadAiProviderConfigFromEnv(
        baseEnv({
          AI_PROVIDER_MAX_RETRIES: "-1",
        })
      )
    ).toThrow(AiProviderConfigError);

    expect(() =>
      loadAiProviderConfigFromEnv(
        baseEnv({
          AI_PROVIDER_TIMEOUT_MS: "not-a-number",
        })
      )
    ).toThrow(/Invalid integer/);
  });

  it("redacts secrets and never includes raw API keys", () => {
    const config = loadAiProviderConfigFromEnv(
      baseEnv({
        AI_PROVIDER_OPENAI_ENABLED: "true",
        AI_PROVIDER_OPENAI_API_KEY: "sk-super-secret",
        AI_PROVIDER_OPENAI_BASE_URL: "https://api.openai.com/v1",
        AI_PROVIDER_OPENAI_DEFAULT_MODEL: "gpt-5.5",
      })
    );
    const redacted = redactAiProviderConfig(config);
    const serialized = JSON.stringify(redacted);
    expect(serialized).not.toContain("sk-super-secret");
    expect(redacted.providers.openai.apiKey).toBe("[REDACTED]");
    expect(redacted.providers.seedance.apiKey).toBe("unset");
  });

  it("getAiProviderConfig fail-fast caches valid config", () => {
    const env = baseEnv();
    const a = getAiProviderConfig(env);
    const b = getAiProviderConfig(env);
    expect(a).toEqual(b);
  });

  it("validateAiProviderConfig rejects malformed objects", () => {
    const bad = {
      routingMode: "fixed",
      defaults: { text: "openai", video: "seedance", upscale: "fal" },
      costTrackingEnabled: true,
      usageLogEnabled: true,
      timeoutMs: 1000,
      maxRetries: 1,
      providers: {
        openai: {
          id: "openai",
          enabled: true,
          baseUrl: "https://api.openai.com/v1",
          apiKey: null,
          defaultModel: "gpt-5.5",
        },
        seedance: {
          id: "seedance",
          enabled: false,
          baseUrl: null,
          apiKey: null,
          defaultModel: null,
        },
        minimax: {
          id: "minimax",
          enabled: false,
          baseUrl: null,
          apiKey: null,
          defaultModel: null,
        },
        fal: {
          id: "fal",
          enabled: false,
          baseUrl: null,
          apiKey: null,
          defaultModel: null,
        },
      },
    } as AiProviderConfig;

    expect(() => validateAiProviderConfig(bad)).toThrow(/API key is required/);
  });

  it("does not include Flux in the V1 provider set", () => {
    const config = loadAiProviderConfigFromEnv(baseEnv());
    expect(Object.keys(config.providers).sort()).toEqual([
      "fal",
      "minimax",
      "openai",
      "seedance",
    ]);
    expect("flux" in config.providers).toBe(false);
  });
});
