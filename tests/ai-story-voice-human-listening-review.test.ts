import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AI_STORY_AUDIO_PLAN,
  AI_STORY_TTS_EXECUTION,
  ASSEMBLY_V2_AUDIO_INTEGRATION,
  NO_DIALECT_INVENTION,
  PAID_TTS_COMMERCIAL_RUNTIME,
  SG_MY_VOICE_NATURALNESS,
  SG_MY_VOICE_NATURALNESS_CERTIFICATION,
  AiStoryVoiceHumanListeningReviewSchema,
  AiStoryVoiceListeningExecutionPreviewSchema,
  assertFreshPaidListeningAuthorization,
} from "@ceo-agent/shared";
import {
  CURRENT_IMPLEMENTATION_MODEL,
  CURRENT_IMPLEMENTATION_PROVIDER,
  CURRENT_PROVIDER_STATUS,
  CURRENT_RECOMMENDED_PROVIDER_MODEL,
  MIGRATION_REQUIRED,
  MIGRATION_SCOPE,
  MODEL_MIGRATION_REASON,
  MODEL_MIGRATION_RECOMMENDED,
  OPENAI_API_PRICING_URL,
  OPENAI_GPT_4O_MINI_TTS_MODEL_URL,
  OPENAI_SPEECH_OFFICIAL_GUIDE_URL,
  buildProposedSgMyVoiceListeningExecutionPreview,
  buildProposedSgMyVoiceListeningSamples,
  computeAiStoryVoiceListeningRequestFingerprint,
  deriveVoiceListeningCertificationResult,
} from "@ceo-agent/shared/server";

const id = (n: number) =>
  `b9000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const hash = (n: number) => `sha256:${n.toString(16).padStart(64, "0")}`;

describe("AI Story SG/MY human listening certification authority", () => {
  it("records the official-provider model review without silently migrating runtime", () => {
    expect(CURRENT_IMPLEMENTATION_PROVIDER).toBe("openai");
    expect(CURRENT_IMPLEMENTATION_MODEL).toBe("tts-1-hd");
    expect(CURRENT_PROVIDER_STATUS).toBe(
      "SUPPORTED_OLDER_MODEL_NOT_OFFICIALLY_LABELLED_LEGACY"
    );
    expect(CURRENT_RECOMMENDED_PROVIDER_MODEL).toBe("gpt-4o-mini-tts");
    expect(MODEL_MIGRATION_RECOMMENDED).toBe(true);
    expect(MIGRATION_REQUIRED).toBe(true);
    expect(MIGRATION_SCOPE).toBe(
      "CAPABILITY_DRIVEN_ADAPTER_MODEL_AND_INSTRUCTIONS_UPDATE"
    );
    expect(MODEL_MIGRATION_REASON).toContain("newest and most reliable");
    expect(OPENAI_SPEECH_OFFICIAL_GUIDE_URL).toMatch(/^https:\/\/platform\.openai\.com/);
    expect(OPENAI_GPT_4O_MINI_TTS_MODEL_URL).toMatch(/^https:\/\/platform\.openai\.com/);
    expect(OPENAI_API_PRICING_URL).toBe("https://openai.com/api/pricing/");
  });

  it("builds six payable locale samples with model-specific unverified code-switch", () => {
    const preview = buildProposedSgMyVoiceListeningExecutionPreview();
    expect(AiStoryVoiceListeningExecutionPreviewSchema.parse(preview)).toEqual(
      preview
    );
    expect(preview.samples).toHaveLength(6);
    expect(preview.paidSampleCount).toBe(6);
    expect(preview.totalCharacters).toBe(282);
    expect(preview.samples.map((sample) => sample.capability.locale)).toEqual([
      "en-SG",
      "en-MY",
      "zh-SG",
      "zh-MY",
      "ms-MY",
      "CODE_SWITCH",
    ]);
    const codeSwitch = preview.samples.at(-1)!;
    expect(codeSwitch.status).toBe("PLANNED_AWAITING_AUTHORIZATION");
    expect(codeSwitch.expectedPaidCallCount).toBe(1);
    expect(codeSwitch.blockedReason).toBeNull();
    expect(codeSwitch.capability.codeSwitchCapabilityStatus).toBe(
      "UNVERIFIED_FOR_GPT_4O_MINI_TTS"
    );
    expect(codeSwitch.exactScriptText).toBe("Tak apa, later I settle.");
    expect(codeSwitch.exactScriptText).not.toMatch(/\b(lah|leh|lor|ah)\b/i);
    expect(preview.authorizationStatus).toBe(
      "WAITING_FOR_EXPLICIT_PAID_TTS_AUTHORIZATION"
    );
  });

  it("preserves exact Script text and never invents dialect particles", () => {
    const samples = buildProposedSgMyVoiceListeningSamples();
    const sg = samples.find((sample) => sample.capability.locale === "en-SG")!;
    expect(sg.exactScriptText).toBe(
      "Your flowers are arriving this afternoon, right on time for the surprise."
    );
    expect(sg.exactScriptText).not.toMatch(/\b(lah|lor|leh|meh|sia)\b/i);
    expect(sg.characterCount).toBe(Array.from(sg.exactScriptText).length);
    expect(samples.every((sample) => sample.capability.generationSettings.noTextRewrite === true)).toBe(true);
  });

  it("fingerprints each provider/model/voice/locale/style/settings tuple independently", () => {
    const samples = buildProposedSgMyVoiceListeningSamples();
    expect(new Set(samples.map((sample) => sample.requestFingerprint)).size).toBe(
      samples.length
    );
    const first = samples[0]!;
    const changedVoice = {
      ...first.capability,
      voice: "cedar",
    };
    expect(
      computeAiStoryVoiceListeningRequestFingerprint({
        capability: changedVoice,
        exactScriptText: first.exactScriptText,
      })
    ).not.toBe(first.requestFingerprint);
  });

  it("uses categorical human findings and rejects fake PASS over a failed dimension", () => {
    const sample = buildProposedSgMyVoiceListeningSamples()[0]!;
    const valid = {
      reviewId: id(1),
      contractVersion: "ai-story-voice-human-listening-review.v1" as const,
      sampleId: sample.sampleId,
      requestFingerprint: sample.requestFingerprint,
      outputContentHash: hash(1),
      capability: sample.capability,
      reviewerId: id(2),
      dimensions: {
        intelligibility: "PASS",
        pronunciationAccuracy: "PASS",
        naturalness: "WARN",
        pacing: "PASS",
        emotionalFit: "PASS",
        commercialUsability: "PASS",
        localeAcceptability: "PASS",
        roboticArtifacts: "PASS",
        unwantedAccentStylization: "PASS",
        codeSwitchQuality: "NOT_APPLICABLE",
      },
      conciseFindings: ["Clear and usable; naturalness requires reviewer confirmation."],
      decision: "WARN",
      reviewedAt: "2026-09-21T04:00:00.000Z",
      supersedesReviewId: null,
    } as const;
    expect(AiStoryVoiceHumanListeningReviewSchema.parse(valid)).toEqual(valid);
    expect(
      AiStoryVoiceHumanListeningReviewSchema.safeParse({
        ...valid,
        decision: "PASS",
        dimensions: { ...valid.dimensions, naturalness: "FAIL" },
      }).success
    ).toBe(false);
    expect(JSON.stringify(valid)).not.toMatch(/score|percent|100/);
  });

  it("derives partial certification when any selected locale or code-switch is unavailable", () => {
    expect(
      deriveVoiceListeningCertificationResult({
        "en-SG": "PASS",
        "en-MY": "PASS",
        "zh-SG": "PASS",
        "zh-MY": "PASS",
        "ms-MY": "PASS",
        CODE_SWITCH: "CAPABILITY_UNSUPPORTED",
      })
    ).toBe("PARTIALLY_CERTIFIED");
    expect(
      deriveVoiceListeningCertificationResult({
        "en-SG": "PASS",
        "en-MY": "PASS",
        "zh-SG": "PASS",
        "zh-MY": "PASS",
        "ms-MY": "PASS",
        CODE_SWITCH: "PASS",
      })
    ).toBe("CERTIFIED_FOR_SELECTED_LOCALES");
  });

  it("forbids calls while waiting and requires fresh authorization for every retry", () => {
    const sample = buildProposedSgMyVoiceListeningSamples()[0]!;
    expect(() =>
      assertFreshPaidListeningAuthorization({
        authorizationStatus: "WAITING",
        authorizedSampleIds: [],
        requestedSampleId: sample.sampleId,
        attempt: 1,
      })
    ).toThrow(/EXPLICIT_PAID_TTS_AUTHORIZATION_REQUIRED/);
    expect(() =>
      assertFreshPaidListeningAuthorization({
        authorizationStatus: "AUTHORIZED",
        authorizedSampleIds: [sample.sampleId],
        requestedSampleId: sample.sampleId,
        attempt: 2,
      })
    ).toThrow(/EXPLICIT_PAID_TTS_AUTHORIZATION_REQUIRED/);
  });

  it("preserves #145 authority while commercial runtime and naturalness stay pending", () => {
    expect(AI_STORY_AUDIO_PLAN).toBe("CERTIFIED");
    expect(AI_STORY_TTS_EXECUTION).toBe("CERTIFIED");
    expect(ASSEMBLY_V2_AUDIO_INTEGRATION).toBe("CERTIFIED");
    expect(NO_DIALECT_INVENTION).toBe("CERTIFIED");
    expect(SG_MY_VOICE_NATURALNESS).toBe("PENDING_HUMAN_LISTENING_REVIEW");
    expect(SG_MY_VOICE_NATURALNESS_CERTIFICATION).toBe(
      "PENDING_HUMAN_LISTENING_REVIEW"
    );
    expect(PAID_TTS_COMMERCIAL_RUNTIME).toBe("BLOCKED");
  });

  it("contains no Provider dispatch, production mutation, commercial mutation, or audio binary", () => {
    const contract = readFileSync(
      "packages/shared/src/ai-story-voice-human-listening-review.ts",
      "utf8"
    );
    const server = readFileSync(
      "packages/shared/src/ai-story-voice-human-listening-review.server.ts",
      "utf8"
    );
    expect(contract + server).not.toMatch(
      /getOpenAI|audio\.speech\.create|fetch\(|releaseRemaining/i
    );
    expect(server).not.toMatch(/from\s+["'][^"']*(commercial|billing|provider-runtime)/i);
    expect(contract + server).not.toMatch(/Buffer\.from|writeFile|\.mp3|\.wav/i);
  });

  it("listening executor is six-call bounded, authorization-gated, and has no retry loop", () => {
    const executor = readFileSync(
      "scripts/_local-ai-story-voice-listening-execute.ts",
      "utf8"
    );
    expect(executor).toContain("MAXIMUM_AUTHORIZED_CALLS = 6");
    expect(executor).toContain("EXPLICIT_PAID_TTS_AUTHORIZATION_REQUIRED");
    expect(executor).toContain("gpt-4o-mini-tts");
    expect(executor).toContain('voice: "marin"');
    expect(executor).toContain('response_format: "wav"');
    expect(executor).not.toMatch(/retryAiStory|while\s*\(|do\s*\{/);
    expect(executor).not.toMatch(/reservation|settlement|billing|releaseRemaining/i);
  });
});
