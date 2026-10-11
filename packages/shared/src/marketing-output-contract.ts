import { z } from "zod";
import {
  StrategyPlanSchema,
  normalizeMarketingContentPackage,
  type MarketingContentPackage,
  type StrategyPlan,
} from "./types/marketing-os";

export const MARKETING_OUTPUT_SCHEMA_VERSION = "marketing-output-v1";

export const STRATEGY_JSON_CONTRACT =
  "{ industry, businessType, product, marketingGoal, marketingAngle, brandPersonality: string[], tone, videoStyle, audience: { interests: string[], painPoints: string[], location?, desiredOutcome? }, customerJourney, platformPriority: string[], ctaStrategy, keywords: string[], hashtags: { industry, local, trending, seo }, confidence }";

export const CONTENT_JSON_CONTRACT =
  "Top-level voiceScripts {15s,30s,60s}, voiceScriptsEn, voiceScriptsZh, hooks [{text,type}], cta [{text}], musicMood, captions, broll, subtitleTimeline, postingRecommendation. Do not wrap these keys.";

export type MarketingContractDiagnostic = {
  ok: boolean;
  stage: "strategy" | "content";
  schemaVersion: typeof MARKETING_OUTPUT_SCHEMA_VERSION;
  codes: string[];
  fields: string[];
  fallback: "none";
};

export type StrategyContractFacts = {
  services?: string[] | null;
  companyName?: string | null;
  brief?: string | null;
};

const INSTRUCTION_LEAK = /promote only these authorized facts|do not add prices|video generation stays unauthorized|^request:/i;
const UNSUPPORTED_CLAIM = /guaranteed conversion|保证转化|\$\d|\bRM\s?\d/i;

export function isMarketingInstructionLeak(text: string | null | undefined): boolean {
  const value = text?.trim() ?? "";
  if (!value) return false;
  if (INSTRUCTION_LEAK.test(value)) return true;
  return value.length > 180 && /business name:/i.test(value);
}

function diagnostic(
  stage: MarketingContractDiagnostic["stage"],
  codes: string[],
  fields: string[]
): MarketingContractDiagnostic {
  return {
    ok: codes.length === 0,
    stage,
    schemaVersion: MARKETING_OUTPUT_SCHEMA_VERSION,
    codes,
    fields,
    fallback: "none",
  };
}

function issueFields(error: z.ZodError): string[] {
  return error.issues.map((issue) => issue.path.join(".") || issue.code);
}

function coerceStrategyShape(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const data = { ...(raw as Record<string, unknown>) };
  if (typeof data.audience === "string") {
    data.audience = { interests: [], painPoints: [], desiredOutcome: data.audience };
  }
  if (Array.isArray(data.hashtags)) {
    data.hashtags = { industry: data.hashtags, local: [], trending: [], seo: [] };
  }
  if (typeof data.platformPriority === "string") data.platformPriority = [data.platformPriority];
  if (typeof data.brandPersonality === "string") data.brandPersonality = [data.brandPersonality];
  if (typeof data.keywords === "string") data.keywords = [data.keywords];
  if (typeof data.confidence === "string") {
    const parsed = Number(data.confidence);
    if (Number.isFinite(parsed)) data.confidence = parsed > 1 ? parsed / 100 : parsed;
  }
  return data;
}

function productIsGrounded(product: string, services: string[]): boolean {
  const value = product.trim().toLowerCase();
  if (!value || value.length > 160) return false;
  if (services.length === 0) return true;
  return services.some((service) => {
    const authorized = service.trim().toLowerCase();
    return authorized.length > 0 && (value.includes(authorized) || authorized.includes(value));
  });
}

export function evaluateStrategyContract(
  raw: unknown,
  facts: StrategyContractFacts = {}
): { diagnostic: MarketingContractDiagnostic; plan: StrategyPlan | null } {
  const parsed = StrategyPlanSchema.safeParse(coerceStrategyShape(raw));
  if (!parsed.success) {
    return { diagnostic: diagnostic("strategy", ["STRATEGY_SCHEMA_INVALID"], issueFields(parsed.error)), plan: null };
  }
  const codes: string[] = [];
  const fields: string[] = [];
  const product = parsed.data.product.trim();
  if (!product) {
    codes.push("PRODUCT_MISSING");
    fields.push("product");
  } else if (isMarketingInstructionLeak(product) || (facts.brief && product === facts.brief.trim())) {
    codes.push("PRODUCT_IS_BRIEF");
    fields.push("product");
  } else if (!productIsGrounded(product, (facts.services ?? []).filter(Boolean) as string[])) {
    codes.push("PRODUCT_UNGROUNDED");
    fields.push("product");
  }
  const copy = JSON.stringify(parsed.data);
  if (UNSUPPORTED_CLAIM.test(copy)) {
    codes.push("UNSUPPORTED_CLAIM");
    fields.push("strategy");
  }
  if (codes.length > 0) return { diagnostic: diagnostic("strategy", codes, fields), plan: null };
  return { diagnostic: diagnostic("strategy", [], []), plan: parsed.data };
}

function hasCreativeKeys(value: Record<string, unknown>): boolean {
  return Boolean(value.hooks || value.cta || value.voiceScripts || value.voice_scripts || value.musicMood || value.music_mood);
}

export function unwrapMarketingContentPayload(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const data = raw as Record<string, unknown>;
  if (hasCreativeKeys(data)) return aliasContentFields(data);
  for (const value of Object.values(data)) {
    if (value && typeof value === "object" && !Array.isArray(value) && hasCreativeKeys(value as Record<string, unknown>)) {
      return aliasContentFields(value as Record<string, unknown>);
    }
  }
  return aliasContentFields(data);
}

function aliasContentFields(data: Record<string, unknown>): Record<string, unknown> {
  const next = { ...data };
  if (next.musicMood == null) next.musicMood = next.music_mood ?? next.bgm ?? next.music;
  if (next.voiceScripts == null) next.voiceScripts = next.voice_scripts ?? next.scripts;
  if (next.hooks == null) next.hooks = next.hookList ?? next.hook_list ?? (Array.isArray(next.hook) ? next.hook : undefined);
  if (next.cta == null) next.cta = next.ctas ?? next.callToAction ?? next.callsToAction ?? next.call_to_action;
  return next;
}

function spokenLength(text: string): number {
  const characters = text.match(/\p{Script=Han}/gu)?.length ?? 0;
  const words = text.replace(/\p{Script=Han}/gu, " ").trim().split(/\s+/).filter(Boolean).length;
  return characters + words;
}

export function evaluateContentContract(
  raw: unknown,
  facts: { brief?: string | null } = {}
): { diagnostic: MarketingContractDiagnostic; contentPackage: MarketingContentPackage | null } {
  if (typeof raw === "string") {
    return { diagnostic: diagnostic("content", ["CONTENT_JSON_TRUNCATED"], ["body"]), contentPackage: null };
  }
  const payload = unwrapMarketingContentPayload(raw);
  if (!payload) {
    return { diagnostic: diagnostic("content", ["CONTENT_SCHEMA_INVALID"], ["body"]), contentPackage: null };
  }
  const contentPackage = normalizeMarketingContentPackage(payload);
  if (!contentPackage) {
    const codes: string[] = ["CONTENT_SCHEMA_INVALID"];
    const fields: string[] = [];
    const hooks = payload.hooks ?? payload.hookList ?? payload.hook;
    const cta = payload.cta ?? payload.ctas ?? payload.callToAction;
    if (!hooks || (Array.isArray(hooks) && hooks.length === 0)) {
      codes.push("HOOKS_MISSING");
      fields.push("hooks");
    }
    if (!cta || (Array.isArray(cta) && cta.length === 0)) {
      codes.push("CTA_MISSING");
      fields.push("cta");
    }
    if (!String(payload.musicMood ?? payload.music_mood ?? "").trim()) {
      codes.push("MUSIC_MOOD_MISSING");
      fields.push("musicMood");
    }
    return { diagnostic: diagnostic("content", codes, fields), contentPackage: null };
  }
  const codes: string[] = [];
  const fields: string[] = [];
  if (!contentPackage.musicMood.trim()) {
    codes.push("MUSIC_MOOD_MISSING");
    fields.push("musicMood");
  }
  const script30 = contentPackage.voiceScripts["30s"].trim();
  const script15 = contentPackage.voiceScripts["15s"].trim();
  if (!script30) {
    codes.push("SCRIPT_MISSING");
    fields.push("voiceScripts.30s");
  } else if (script15 && spokenLength(script30) < spokenLength(script15)) {
    codes.push("SCRIPT_DURATION_INVALID");
    fields.push("voiceScripts");
  }
  const copy = [
    script15,
    script30,
    contentPackage.voiceScripts["60s"],
    contentPackage.voiceScriptsEn?.["15s"],
    contentPackage.voiceScriptsEn?.["30s"],
    contentPackage.voiceScriptsEn?.["60s"],
    contentPackage.voiceScriptsZh?.["15s"],
    contentPackage.voiceScriptsZh?.["30s"],
    contentPackage.voiceScriptsZh?.["60s"],
    ...contentPackage.hooks.map((item) => item.text),
  ].filter(Boolean).join("\n");
  if (contentPackage.contentOrigin === "template_fallback") {
    codes.push("TEMPLATE_FALLBACK");
    fields.push("contentOrigin");
  }
  if (isMarketingInstructionLeak(copy) || (facts.brief && copy.includes(facts.brief))) {
    codes.push("BRIEF_LEAKAGE");
    fields.push("voiceScripts");
  }
  if (UNSUPPORTED_CLAIM.test(copy)) {
    codes.push("UNSUPPORTED_CLAIM");
    fields.push("voiceScripts");
  }
  if (codes.length > 0) return { diagnostic: diagnostic("content", codes, fields), contentPackage: null };
  return { diagnostic: diagnostic("content", [], []), contentPackage };
}

export function contentAllowsTranslation(contentPackage: MarketingContentPackage | null | undefined): boolean {
  if (!contentPackage) return false;
  return evaluateContentContract(contentPackage).diagnostic.ok;
}
