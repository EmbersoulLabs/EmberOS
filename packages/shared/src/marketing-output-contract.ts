import { z } from "zod";
import {
  StrategyPlanSchema,
  normalizeMarketingContentPackage,
  type MarketingContentPackage,
  type StrategyPlan,
} from "./types/marketing-os";

export const MARKETING_OUTPUT_SCHEMA_VERSION = "marketing-output-v1";

/**
 * Compatibility buckets for categorical model labels.
 * These are not calibrated probabilities.
 */
export const STRATEGY_CONFIDENCE_CATEGORY = {
  high: 0.8,
  medium: 0.5,
  low: 0.2,
} as const;

export const STRATEGY_FACT_GROUNDING_RULE =
  "ctaStrategy must be one string, not an array. confidence must be a number from 0 to 1. Use only facts in the business profile. Do not add delivery, discounts, prices, guarantees, testimonials, addresses, or ranking claims unless that fact is in the profile. A geographic audience or hashtag is not a delivery promise.";

export const STRATEGY_JSON_CONTRACT = `${describeZodContract(StrategyPlanSchema)} ${STRATEGY_FACT_GROUNDING_RULE}`;

export const CONTENT_JSON_CONTRACT =
  "Top-level voiceScripts {15s,30s,60s}, voiceScriptsEn, voiceScriptsZh, hooks [{text,type}], cta [{text}], musicMood, captions, broll, subtitleTimeline, postingRecommendation. Do not wrap these keys.";

export type MarketingContractAdjustment = {
  field: string;
  action: "map" | "remove";
  raw: string;
  result?: string | number;
};

export type MarketingContractDiagnostic = {
  ok: boolean;
  stage: "strategy" | "content";
  schemaVersion: typeof MARKETING_OUTPUT_SCHEMA_VERSION;
  codes: string[];
  fields: string[];
  fallback: "none";
  adjustments?: MarketingContractAdjustment[];
};

export type StrategyContractFacts = {
  services?: string[] | null;
  companyName?: string | null;
  brief?: string | null;
  description?: string | null;
  brandKeywords?: string[] | null;
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
  fields: string[],
  adjustments: MarketingContractAdjustment[] = []
): MarketingContractDiagnostic {
  return {
    ok: codes.length === 0,
    stage,
    schemaVersion: MARKETING_OUTPUT_SCHEMA_VERSION,
    codes: [...new Set(codes)],
    fields: [...new Set(fields)],
    fallback: "none",
    ...(adjustments.length ? { adjustments } : {}),
  };
}

function describeZodContract(schema: z.ZodTypeAny): string {
  const name = schema._def.typeName as string;
  if (name === "ZodDefault" || name === "ZodOptional" || name === "ZodNullable") {
    return describeZodContract(schema._def.innerType);
  }
  if (name === "ZodString") return "string";
  if (name === "ZodNumber") {
    const checks = (schema._def.checks ?? []) as Array<{ kind: string; value?: number }>;
    const min = checks.find((check) => check.kind === "min")?.value;
    const max = checks.find((check) => check.kind === "max")?.value;
    if (min === 0 && max === 1) return "number from 0 to 1";
    return "number";
  }
  if (name === "ZodArray") return `${describeZodContract(schema._def.type)}[]`;
  if (name === "ZodObject") {
    const shape = schema._def.shape() as Record<string, z.ZodTypeAny>;
    const fields = Object.entries(shape).map(([key, value]) => `${key}: ${describeZodContract(value)}`);
    return `{ ${fields.join(", ")} }`;
  }
  if (name === "ZodEnum") return (schema._def.values as string[]).map((value) => JSON.stringify(value)).join(" | ");
  return "json";
}

function issueFields(error: z.ZodError): string[] {
  return error.issues.map((issue) => issue.path.join(".") || issue.code);
}

const DELIVERY_CLAIM = /delivery|配送|送货|包邮|当日达|免运/i;
const DISCOUNT_CLAIM = /(?:\d+\s*%|\bdiscount\b|半价|折扣|优惠|促销|\$\s?\d|\bRM\s?\d)/i;
const GUARANTEE_CLAIM = /(?:\bguaranteed\b|保证转化|保证送达|保证到货|品质保证)/i;
const SUPERLATIVE_CLAIM = /(?:\bbest\s+florist\b|最好的花店)/i;
const CTA_OFFER = /\d+\s*%|\bdiscount\b|\bsale\b|free\s+delivery|优惠|折扣|半价|促销|买一送一/i;
const CTA_DENIAL = /no\s+promotion|no\s+discount|not\s+on\s+sale|full\s+price|no\s+delivery|没有优惠|无折扣|不打折|无促销/i;
const NEGATED_FACT = /\b(no|not|without)\b|不提供|不含|没有/i;

function factLines(facts: StrategyContractFacts): string[] {
  return [facts.description ?? "", ...(facts.services ?? []), ...(facts.brandKeywords ?? [])]
    .map((item) => item?.trim() ?? "")
    .filter(Boolean);
}

function profileAllows(lines: string[], pattern: RegExp): boolean {
  return lines.some((line) => pattern.test(line) && !NEGATED_FACT.test(line));
}

function unsupportedClaim(text: string, facts: StrategyContractFacts): boolean {
  const lines = factLines(facts);
  if (DELIVERY_CLAIM.test(text) && !profileAllows(lines, DELIVERY_CLAIM)) return true;
  if (DISCOUNT_CLAIM.test(text) && !profileAllows(lines, DISCOUNT_CLAIM)) return true;
  if (GUARANTEE_CLAIM.test(text) && !profileAllows(lines, /guaranteed|保证/i)) return true;
  if (SUPERLATIVE_CLAIM.test(text) && !profileAllows(lines, SUPERLATIVE_CLAIM)) return true;
  return false;
}

function lowerFirstEnglish(text: string): string {
  const stripped = text.replace(/[.。!！?？]+$/g, "").trim();
  const first = stripped.charAt(0);
  if (first >= "A" && first <= "Z") return `${first.toLowerCase()}${stripped.slice(1)}`;
  return stripped;
}

function joinCtaItems(items: string[]): string {
  const han = items.every((item) => {
    const characters = item.match(/\p{Script=Han}/gu)?.length ?? 0;
    return characters > 0 && characters >= item.replace(/\s/g, "").length / 2;
  });
  if (han) {
    const parts = items.map((item) => item.replace(/[。！？.!?]+$/g, "").trim());
    if (parts.length === 2) return `${parts[0]}，并${parts[1]}。`;
    return `${parts.slice(0, -1).join("，")}，并${parts[parts.length - 1]}。`;
  }
  const [first, ...rest] = items;
  const head = first.replace(/\.+$/g, "").trim();
  if (rest.length === 1) return `${head} and ${lowerFirstEnglish(rest[0])}.`;
  const middle = rest.slice(0, -1).map(lowerFirstEnglish);
  return `${head}, ${middle.join(", ")}, and ${lowerFirstEnglish(rest[rest.length - 1])}.`;
}

function normalizeCtaStrategy(
  value: unknown,
  codes: string[],
  fields: string[],
  adjustments: MarketingContractAdjustment[]
): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      codes.push("CTA_MISSING");
      fields.push("ctaStrategy");
      return undefined;
    }
    return trimmed;
  }
  if (!Array.isArray(value)) {
    codes.push(value == null ? "CTA_MISSING" : "CTA_MALFORMED");
    fields.push("ctaStrategy");
    return undefined;
  }
  const items: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (!trimmed || items.includes(trimmed)) continue;
    items.push(trimmed);
  }
  if (items.length === 0) {
    codes.push("CTA_MISSING");
    fields.push("ctaStrategy");
    return undefined;
  }
  if (items.some((item) => CTA_OFFER.test(item)) && items.some((item) => CTA_DENIAL.test(item))) {
    codes.push("CTA_CONFLICT");
    fields.push("ctaStrategy");
    return undefined;
  }
  if (items.length === 1) return items[0];
  const joined = joinCtaItems(items);
  adjustments.push({ field: "ctaStrategy", action: "map", raw: JSON.stringify(items), result: joined });
  return joined;
}

function mapConfidenceNumber(
  value: number,
  raw: string,
  adjustments: MarketingContractAdjustment[]
): number | null {
  if (!Number.isFinite(value)) return null;
  if (value >= 0 && value <= 1) return value;
  if (Number.isInteger(value) && value > 1 && value <= 100) {
    const mapped = value / 100;
    adjustments.push({ field: "confidence", action: "map", raw, result: mapped });
    return mapped;
  }
  return null;
}

function normalizeConfidence(
  value: unknown,
  codes: string[],
  fields: string[],
  adjustments: MarketingContractAdjustment[]
): number | undefined {
  if (value == null) return undefined;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      codes.push("CONFIDENCE_MALFORMED");
      fields.push("confidence");
      return undefined;
    }
    const mapped = mapConfidenceNumber(value, String(value), adjustments);
    if (mapped == null) {
      codes.push("CONFIDENCE_OUT_OF_RANGE");
      fields.push("confidence");
      return undefined;
    }
    return mapped;
  }
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    if (text === "high" || text === "medium" || text === "low") {
      const mapped = STRATEGY_CONFIDENCE_CATEGORY[text];
      adjustments.push({ field: "confidence", action: "map", raw: text, result: mapped });
      return mapped;
    }
    const labels = (["high", "medium", "low"] as const).filter((label) => new RegExp(`\\b${label}\\b`).test(text));
    if (labels.length > 1) {
      codes.push("CONFIDENCE_CONTRADICTORY");
      fields.push("confidence");
      return undefined;
    }
    if (labels.length === 1 || !text) {
      codes.push(text ? "CONFIDENCE_UNKNOWN" : "CONFIDENCE_MALFORMED");
      fields.push("confidence");
      return undefined;
    }
    if (!Number.isFinite(Number(text))) {
      codes.push("CONFIDENCE_UNKNOWN");
      fields.push("confidence");
      return undefined;
    }
    const mapped = mapConfidenceNumber(Number(text), text, adjustments);
    if (mapped == null) {
      codes.push("CONFIDENCE_OUT_OF_RANGE");
      fields.push("confidence");
      return undefined;
    }
    return mapped;
  }
  if (Array.isArray(value)) {
    codes.push(value.length > 1 ? "CONFIDENCE_CONTRADICTORY" : "CONFIDENCE_MALFORMED");
    fields.push("confidence");
    return undefined;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const labelRaw = typeof record.label === "string" ? record.label : typeof record.level === "string" ? record.level : undefined;
    const numeric = typeof record.value === "number" ? record.value : typeof record.score === "number" ? record.score : undefined;
    if (labelRaw && numeric != null) {
      const label = labelRaw.trim().toLowerCase();
      const category = label === "high" || label === "medium" || label === "low" ? STRATEGY_CONFIDENCE_CATEGORY[label] : undefined;
      if (category == null || Math.abs(category - numeric) > 0.001) {
        codes.push("CONFIDENCE_CONTRADICTORY");
        fields.push("confidence");
        return undefined;
      }
      adjustments.push({ field: "confidence", action: "map", raw: label, result: numeric });
      return numeric;
    }
    if (labelRaw) return normalizeConfidence(labelRaw, codes, fields, adjustments);
    if (numeric != null) return normalizeConfidence(numeric, codes, fields, adjustments);
  }
  codes.push("CONFIDENCE_MALFORMED");
  fields.push("confidence");
  return undefined;
}

function stripOptionalClaims(
  items: unknown,
  field: string,
  facts: StrategyContractFacts,
  adjustments: MarketingContractAdjustment[]
): unknown {
  if (!Array.isArray(items)) return items;
  const kept: unknown[] = [];
  for (const item of items) {
    if (typeof item === "string" && unsupportedClaim(item, facts)) {
      adjustments.push({ field, action: "remove", raw: item });
      continue;
    }
    kept.push(item);
  }
  return kept;
}

function rejectProseClaims(
  field: string,
  value: unknown,
  facts: StrategyContractFacts,
  codes: string[],
  fields: string[]
) {
  if (typeof value !== "string" || !value.trim() || !unsupportedClaim(value, facts)) return;
  codes.push("UNSUPPORTED_CLAIM");
  fields.push(field);
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

export function strategyAllowsContent(result: {
  diagnostic: MarketingContractDiagnostic;
  plan: StrategyPlan | null;
}): boolean {
  return result.diagnostic.ok && result.plan !== null;
}

export function evaluateStrategyContract(
  raw: unknown,
  facts: StrategyContractFacts = {}
): { diagnostic: MarketingContractDiagnostic; plan: StrategyPlan | null } {
  const codes: string[] = [];
  const fields: string[] = [];
  const adjustments: MarketingContractAdjustment[] = [];
  const shaped = coerceStrategyShape(raw);
  if (!shaped || typeof shaped !== "object" || Array.isArray(shaped)) {
    return { diagnostic: diagnostic("strategy", ["STRATEGY_SCHEMA_INVALID"], ["body"]), plan: null };
  }
  const data = shaped as Record<string, unknown>;
  const cta = normalizeCtaStrategy(data.ctaStrategy, codes, fields, adjustments);
  if (cta == null) delete data.ctaStrategy;
  else data.ctaStrategy = cta;
  if ("confidence" in data) {
    const confidence = normalizeConfidence(data.confidence, codes, fields, adjustments);
    if (confidence == null) delete data.confidence;
    else data.confidence = confidence;
  }
  data.keywords = stripOptionalClaims(data.keywords, "keywords", facts, adjustments);
  data.brandPersonality = stripOptionalClaims(data.brandPersonality, "brandPersonality", facts, adjustments);
  if (data.hashtags && typeof data.hashtags === "object" && !Array.isArray(data.hashtags)) {
    const hashtags = { ...(data.hashtags as Record<string, unknown>) };
    for (const key of ["industry", "local", "trending", "seo"]) {
      hashtags[key] = stripOptionalClaims(hashtags[key], `hashtags.${key}`, facts, adjustments);
    }
    data.hashtags = hashtags;
  }
  for (const field of ["industry", "businessType", "product", "marketingGoal", "marketingAngle", "tone", "videoStyle", "customerJourney", "ctaStrategy"]) {
    rejectProseClaims(field, data[field], facts, codes, fields);
  }
  const audience = data.audience && typeof data.audience === "object" && !Array.isArray(data.audience)
    ? data.audience as Record<string, unknown>
    : null;
  if (audience) {
    for (const field of ["desiredOutcome", "buyingIntent", "location"]) {
      rejectProseClaims(`audience.${field}`, audience[field], facts, codes, fields);
    }
    for (const field of ["interests", "painPoints"]) {
      const items = audience[field];
      if (!Array.isArray(items)) continue;
      if (items.some((item) => typeof item === "string" && unsupportedClaim(item, facts))) {
        codes.push("UNSUPPORTED_CLAIM");
        fields.push(`audience.${field}`);
      }
    }
  }
  const parsed = StrategyPlanSchema.safeParse(data);
  if (!parsed.success) {
    const schemaFields = issueFields(parsed.error).filter((field) => !fields.includes(field));
    if (schemaFields.length) {
      codes.push("STRATEGY_SCHEMA_INVALID");
      fields.push(...schemaFields);
    }
    return { diagnostic: diagnostic("strategy", codes, fields, adjustments), plan: null };
  }
  if (codes.length) return { diagnostic: diagnostic("strategy", codes, fields, adjustments), plan: null };
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
  if (codes.length > 0) return { diagnostic: diagnostic("strategy", codes, fields, adjustments), plan: null };
  return { diagnostic: diagnostic("strategy", [], [], adjustments), plan: parsed.data };
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
