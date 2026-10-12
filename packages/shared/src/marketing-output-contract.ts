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
  "ctaStrategy must be one string, not an array. confidence must be a number from 0 to 1. Use only facts in the business profile. Choose the CTA only from creativeFacts.approvedCtaChannels. A campaign platform is not a connected social account or a messaging channel. Do not add delivery, discounts, prices, guarantees, testimonials, addresses, or ranking claims unless that fact is in the profile. A geographic audience or hashtag is not a storefront or a delivery promise.";

export const STRATEGY_JSON_CONTRACT = `${describeZodContract(StrategyPlanSchema)} ${STRATEGY_FACT_GROUNDING_RULE}`;

export const CONTENT_JSON_CONTRACT =
  "Top-level voiceScripts {15s,30s,60s}, voiceScriptsEn, voiceScriptsZh, hooks [{text,type}], cta [{text}], musicMood, captions, broll, subtitleTimeline [{startSec:number, endSec:number, text:string}], postingRecommendation. Do not wrap these keys.";

export type MarketingContractAdjustment = {
  field: string;
  action: "map" | "remove";
  raw: string;
  result?: string | number;
};

export type MarketingClaimCategory =
  | "delivery"
  | "discount"
  | "guarantee"
  | "ranking"
  | "location"
  | "testimonial"
  | "channel";

export type MarketingContractIssue = {
  code: string;
  field: string;
  expected?: string;
  received?: string;
  claimCategory?: MarketingClaimCategory;
  normalizable?: boolean;
  excerpt?: string;
  authorization?: string;
};

export type CreativeQualityStatus = "PASS" | "FAIL" | "REQUIRES_CREATIVE_REVIEW";

export type CreativeQualityDimensionName =
  | "hook"
  | "storyProgression"
  | "productClarity"
  | "commercialRelevance"
  | "visualExecutability"
  | "languageNaturalness"
  | "businessGrounding";

export type CreativeQualityReport = {
  status: CreativeQualityStatus;
  total: number | null;
  maxScore: 35;
  dimensions: Array<{
    name: CreativeQualityDimensionName;
    score: number | null;
    basis: "deterministic" | "structural";
    evidence: string;
  }>;
};

export type MarketingContractDiagnostic = {
  ok: boolean;
  stage: "strategy" | "content";
  schemaVersion: typeof MARKETING_OUTPUT_SCHEMA_VERSION;
  codes: string[];
  fields: string[];
  fallback: "none";
  adjustments?: MarketingContractAdjustment[];
  issues?: MarketingContractIssue[];
  providerRequestId?: string;
  quality?: CreativeQualityReport;
};

export type StrategyContractFacts = {
  services?: string[] | null;
  companyName?: string | null;
  brief?: string | null;
  description?: string | null;
  brandKeywords?: string[] | null;
  address?: string | null;
  audience?: string | null;
  city?: string | null;
  country?: string | null;
  website?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  socialAccounts?: string[] | null;
  catalogUrl?: string | null;
  orderingChannel?: string | null;
};

export type ContentContractFacts = StrategyContractFacts & {
  durationSec?: number | null;
  providerRequestId?: string | null;
  platforms?: string[] | null;
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
  adjustments: MarketingContractAdjustment[] = [],
  issues: MarketingContractIssue[] = [],
  providerRequestId?: string | null,
  quality?: CreativeQualityReport
): MarketingContractDiagnostic {
  const bounded = issues.slice(0, 64).map((issue) => ({
    ...issue,
    ...(issue.excerpt ? { excerpt: issue.excerpt.replace(/\s+/g, " ").trim().slice(0, 80) } : {}),
    ...(issue.received ? { received: issue.received.slice(0, 120) } : {}),
  }));
  const requestId = typeof providerRequestId === "string" && /^[A-Za-z0-9_-]{8,80}$/.test(providerRequestId)
    ? providerRequestId
    : undefined;
  return {
    ok: codes.length === 0,
    stage,
    schemaVersion: MARKETING_OUTPUT_SCHEMA_VERSION,
    codes: [...new Set(codes)],
    fields: [...new Set(fields)],
    fallback: "none",
    ...(adjustments.length ? { adjustments } : {}),
    ...(bounded.length ? { issues: bounded } : {}),
    ...(requestId ? { providerRequestId: requestId } : {}),
    ...(quality ? { quality } : {}),
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

const DELIVERY_CLAIM = /delivery|same-?day|配送|送货|包邮|当日达|免运|penghantaran|hari yang sama/i;
const DISCOUNT_CLAIM = /(?:\d+\s*%|\bdiscount\b|半价|折扣|优惠|促销|\$\s?\d|\bRM\s?\d|\bdiskaun\b)/i;
const GUARANTEE_CLAIM = /(?:\bguaranteed\b|保证转化|保证送达|保证到货|品质保证|保证结果|\bdijamin\b)/i;
const RANKING_CLAIM = /(?:\bbest\s+florist\b|bestflowerstore|bestflorist|#1\s*florist|number\s+one\s+florist|最好的花店|全岛第一|kedai bunga terbaik|\bfinest\b|最优质|顶级花卉)/i;
const LOCATION_CLAIM = /visit our (?:shop|store)|visit us(?:\s+today|\s+in\s+[A-Za-z]+|\s+at\s+[A-Za-z]+)?|our (?:shop|store)\b|right in the heart of|in the heart of|storefront|walk-?in|shop address|市中心|到店|进店|门店|实体店|欢迎到店|欢迎来到|lawati kedai|di pusat bandar|kunjungi kedai/i;
const TESTIMONIAL_CLAIM = /customer reviews?|customers say|our customers love|five[- ]star|5[- ]star|客户评价|顾客说|真实评价|testimoni pelanggan|pelanggan kata/i;
const CTA_OFFER = /\d+\s*%|\bdiscount\b|\bsale\b|free\s+delivery|优惠|折扣|半价|促销|买一送一/i;
const CTA_DENIAL = /no\s+promotion|no\s+discount|not\s+on\s+sale|full\s+price|no\s+delivery|没有优惠|无折扣|不打折|无促销/i;
const NEGATED_FACT = /\b(no|not|without)\b|不提供|不含|没有/i;

function factLines(facts: StrategyContractFacts): string[] {
  return [facts.description ?? "", facts.address ?? "", ...(facts.services ?? []), ...(facts.brandKeywords ?? [])]
    .map((item) => item?.trim() ?? "")
    .filter(Boolean);
}

function profileAllows(lines: string[], pattern: RegExp): boolean {
  return lines.some((line) => pattern.test(line) && !NEGATED_FACT.test(line));
}

const CLAIM_RULES: Array<{ category: MarketingClaimCategory; pattern: RegExp; allow: RegExp }> = [
  { category: "delivery", pattern: DELIVERY_CLAIM, allow: DELIVERY_CLAIM },
  { category: "discount", pattern: DISCOUNT_CLAIM, allow: DISCOUNT_CLAIM },
  { category: "guarantee", pattern: GUARANTEE_CLAIM, allow: /guaranteed|保证|dijamin/i },
  { category: "ranking", pattern: RANKING_CLAIM, allow: RANKING_CLAIM },
  { category: "location", pattern: LOCATION_CLAIM, allow: LOCATION_CLAIM },
  { category: "testimonial", pattern: TESTIMONIAL_CLAIM, allow: TESTIMONIAL_CLAIM },
];

function claimMatches(text: string, facts: StrategyContractFacts): Array<{ category: MarketingClaimCategory; excerpt: string }> {
  const lines = factLines(facts);
  const hits: Array<{ category: MarketingClaimCategory; excerpt: string }> = [];
  for (const rule of CLAIM_RULES) {
    const match = text.match(rule.pattern);
    if (!match) continue;
    const allowed = rule.category === "location"
      ? Boolean(facts.address?.trim()) || profileAllows(lines, rule.allow)
      : profileAllows(lines, rule.allow);
    if (allowed) continue;
    hits.push({ category: rule.category, excerpt: match[0].replace(/\s+/g, " ").trim().slice(0, 80) });
  }
  return hits;
}

function unsupportedClaim(text: string, facts: StrategyContractFacts): boolean {
  return claimMatches(text, facts).length > 0;
}

export function authorizedMarketingFacts(info: unknown): Pick<StrategyContractFacts, "services" | "description" | "address" | "companyName"> {
  if (!info || typeof info !== "object" || Array.isArray(info)) return {};
  const record = info as Record<string, unknown>;
  const services = Array.isArray(record.services)
    ? record.services.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : undefined;
  return {
    services,
    description: typeof record.description === "string" ? record.description : null,
    address: typeof record.address === "string" ? record.address : null,
    companyName: typeof record.companyName === "string" ? record.companyName : null,
  };
}

/** Only an explicit campaign duration line is an authorized subtitle boundary. */
export function explicitScriptDurationSec(notes: string | null | undefined): number | undefined {
  const match = notes?.match(/(?:^|\n)\s*Duration:\s*(15|30|60)\s+seconds\b/i);
  return match ? Number(match[1]) : undefined;
}

/**
 * Spoken-duration heuristics for the canonical 15/30/60 second slots.
 * These are planning ranges, not a claim that every second is speech.
 * English ~2.4 words/sec, Malay ~2.2 words/sec, Chinese ~4.2 Han characters/sec.
 * A shorter voiceover is plausible only when explicit visual seconds cover the rest.
 */
export const MARKETING_SPEECH_RATES = {
  englishWordsPerSecond: 2.4,
  malayWordsPerSecond: 2.2,
  chineseCharactersPerSecond: 4.2,
  minimumCoveredRatio: 0.85,
  maximumSpeechRatio: 1.15,
} as const;

const MALAY_SPEECH = /\b(dan|untuk|dengan|yang|bunga|segar|anda|kami|ini|pelanggan)\b/i;
const ENGLISH_SPEECH = /\b(the|and|for|with|this|from|your)\b/i;

export function estimateSpokenSeconds(text: string): {
  seconds: number;
  englishWords: number;
  malayWords: number;
  chineseCharacters: number;
} {
  const chineseCharacters = text.match(/\p{Script=Han}/gu)?.length ?? 0;
  const words = text.replace(/\p{Script=Han}/gu, " ").split(/[^A-Za-z]+/).filter(Boolean);
  const malay = MALAY_SPEECH.test(text) && !ENGLISH_SPEECH.test(text);
  const englishWords = malay ? 0 : words.length;
  const malayWords = malay ? words.length : 0;
  const seconds =
    englishWords / MARKETING_SPEECH_RATES.englishWordsPerSecond +
    malayWords / MARKETING_SPEECH_RATES.malayWordsPerSecond +
    chineseCharacters / MARKETING_SPEECH_RATES.chineseCharactersPerSecond;
  return { seconds, englishWords, malayWords, chineseCharacters };
}

export function explicitVisualSeconds(texts: string[]): number {
  let seconds = 0;
  for (const text of texts) {
    for (const match of text.matchAll(/(\d+(?:\.\d+)?)\s*(?:seconds|second|sec)\b/gi)) {
      seconds += Number(match[1]);
    }
  }
  return seconds;
}

export type MarketingCtaAction =
  | "awareness"
  | "follow"
  | "direct_message"
  | "call"
  | "whatsapp"
  | "visit_website"
  | "browse_catalog"
  | "order_online"
  | "visit_store"
  | "delivery"
  | "discount";

export type MarketingCtaAuthority = {
  approved: MarketingCtaAction[];
  unavailable: MarketingCtaAction[];
};

export type MarketingCreativeFactContract = {
  authorizedProducts: string[];
  authorizedServices: string[];
  targetMarket: string | null;
  audience: string | null;
  verifiedLocation: string | null;
  verifiedDelivery: boolean;
  verifiedPromotions: boolean;
  verifiedRankings: boolean;
  approvedCtaChannels: MarketingCtaAction[];
  unavailable: string[];
  ctaAuthority: MarketingCtaAuthority;
};

function textList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

const CTA_DETECTORS: Array<{ action: MarketingCtaAction; pattern: RegExp }> = [
  { action: "direct_message", pattern: /direct message|\bdm us\b|私信|发消息给我们/i },
  { action: "whatsapp", pattern: /whatsapp|wa\.me/i },
  { action: "call", pattern: /\bcall (?:us|now)\b|致电|打电话给我们/i },
  { action: "order_online", pattern: /order online|order through|order this|网上下单|在线下单|网站下单/i },
  { action: "visit_website", pattern: /our website|visit (?:our|the) website|访问网站|我们的网站|laman web kami/i },
  { action: "browse_catalog", pattern: /browse (?:our |the )?(?:catalog|designs)|查看目录|产品目录|katalog/i },
  { action: "follow", pattern: /\bfollow (?:us|our|for|along)\b|关注我们|关注账号|ikuti (?:kami|akaun)/i },
  { action: "visit_store", pattern: LOCATION_CLAIM },
  { action: "delivery", pattern: DELIVERY_CLAIM },
  { action: "discount", pattern: DISCOUNT_CLAIM },
];

function recordOf(info: unknown): Record<string, unknown> {
  return info && typeof info === "object" && !Array.isArray(info) ? (info as Record<string, unknown>) : {};
}

function socialAccountsFrom(record: Record<string, unknown>): string[] {
  const named = ["instagram", "tiktok", "facebook", "youtube", "redNote", "linkedIn", "xiaohongshu", "whatsappBusiness"]
    .map((key) => textOrNull(record[key]))
    .filter((item): item is string => Boolean(item));
  return [...textList(record.socialAccounts), ...named];
}

/** One CTA permission decision. A target platform, market, or industry is not a channel. */
export function resolveMarketingCtaAuthority(info: unknown): MarketingCtaAuthority {
  const record = recordOf(info);
  const services = textList(record.services);
  const description = textOrNull(record.description) ?? textOrNull(record.businessDescription);
  const keywords = textList(record.brandKeywords);
  const lines = [description ?? "", ...services, ...keywords];
  const social = socialAccountsFrom(record).filter((item) => !/whatsapp|wa\.me/i.test(item));
  const whatsapp = textOrNull(record.whatsapp) ?? textOrNull(record.whatsappBusiness);
  const phone = textOrNull(record.phone) ?? textOrNull(record.businessPhone);
  const website = textOrNull(record.website);
  const catalog = textOrNull(record.catalogUrl) ?? textOrNull(record.productPage);
  const ordering = textOrNull(record.orderingChannel) ?? textOrNull(record.orderingUrl);
  const store = textOrNull(record.address) ?? textOrNull(record.verifiedLocation);
  const catalogFact = Boolean(catalog) || profileAllows(lines, /产品目录|\bcatalog\b|product page/i);
  const orderingFact = Boolean(ordering) || profileAllows(lines, /网上下单|在线下单|online order|order online/i);
  const enabled: Record<MarketingCtaAction, boolean> = {
    awareness: true,
    follow: social.length > 0,
    direct_message: Boolean(whatsapp),
    call: Boolean(phone),
    whatsapp: Boolean(whatsapp),
    visit_website: Boolean(website),
    browse_catalog: catalogFact,
    order_online: orderingFact,
    visit_store: Boolean(store),
    delivery: profileAllows(lines, DELIVERY_CLAIM),
    discount: profileAllows(lines, DISCOUNT_CLAIM),
  };
  const actions = Object.keys(enabled) as MarketingCtaAction[];
  return {
    approved: actions.filter((action) => enabled[action]),
    unavailable: actions.filter((action) => !enabled[action]),
  };
}

export function unauthorizedCtaHits(
  text: string,
  authority: MarketingCtaAuthority
): Array<{ action: MarketingCtaAction; excerpt: string }> {
  const hits: Array<{ action: MarketingCtaAction; excerpt: string }> = [];
  for (const detector of CTA_DETECTORS) {
    if (authority.approved.includes(detector.action)) continue;
    const match = text.match(detector.pattern);
    if (!match) continue;
    hits.push({ action: detector.action, excerpt: match[0].replace(/\s+/g, " ").trim().slice(0, 80) });
  }
  return hits;
}

/** Revalidate a stored Strategy CTA against the current profile before any paid Content call. */
export function strategyCtaAllowsContent(cta: string | null | undefined, info: unknown): {
  ok: boolean;
  issues: MarketingContractIssue[];
} {
  const text = cta?.trim() ?? "";
  if (!text) return { ok: true, issues: [] };
  const issues = unauthorizedCtaHits(text, resolveMarketingCtaAuthority(info)).map((hit) => ({
    code: "STRATEGY_CTA_UNAUTHORIZED",
    field: "ctaStrategy",
    expected: "an action in the current CTA authority",
    received: hit.action,
    claimCategory: "channel" as const,
    normalizable: false,
    excerpt: hit.excerpt,
    authorization: "business_profile",
  }));
  return { ok: issues.length === 0, issues };
}

/** Diagnostic used to stop Content and Translation before a paid call. */
export function blockUnauthorizedStrategyCta(
  cta: string | null | undefined,
  info: unknown
): MarketingContractDiagnostic | null {
  const decision = strategyCtaAllowsContent(cta, info);
  if (decision.ok) return null;
  return {
    ok: false,
    stage: "strategy",
    schemaVersion: MARKETING_OUTPUT_SCHEMA_VERSION,
    codes: ["STRATEGY_CTA_UNAUTHORIZED"],
    fields: ["ctaStrategy"],
    fallback: "none",
    issues: decision.issues,
  };
}

/** Compact creative authority derived from the canonical business profile. A market is not a shop. */
export function buildMarketingCreativeFactContract(
  info: unknown,
  _platforms?: string[] | null
): MarketingCreativeFactContract {
  const record = recordOf(info);
  const services = textList(record.services);
  const description = textOrNull(record.description) ?? textOrNull(record.businessDescription);
  const address = textOrNull(record.address);
  const audience = textOrNull(record.audience) ?? textOrNull(record.targetAudience);
  const city = textOrNull(record.city);
  const country = textOrNull(record.country);
  const keywords = textList(record.brandKeywords);
  const lines = [description ?? "", address ?? "", ...services, ...keywords];
  const ctaAuthority = resolveMarketingCtaAuthority(info);
  const unavailable = ctaAuthority.unavailable.map((action) => action.replaceAll("_", " "));
  const market = [city, country].filter(Boolean).join(", ");
  return {
    authorizedProducts: services,
    authorizedServices: services,
    targetMarket: market || null,
    audience,
    verifiedLocation: address,
    verifiedDelivery: ctaAuthority.approved.includes("delivery"),
    verifiedPromotions: ctaAuthority.approved.includes("discount"),
    verifiedRankings: profileAllows(lines, RANKING_CLAIM),
    approvedCtaChannels: ctaAuthority.approved,
    unavailable,
    ctaAuthority,
  };
}

export function creativeAuthorizationFromBusiness(
  info: unknown,
  platforms?: string[] | null
): Pick<
  ContentContractFacts,
  | "audience"
  | "city"
  | "country"
  | "website"
  | "phone"
  | "whatsapp"
  | "socialAccounts"
  | "catalogUrl"
  | "orderingChannel"
  | "address"
  | "platforms"
> {
  const record = recordOf(info);
  return {
    audience: textOrNull(record.audience) ?? textOrNull(record.targetAudience),
    city: textOrNull(record.city),
    country: textOrNull(record.country),
    website: textOrNull(record.website),
    phone: textOrNull(record.phone) ?? textOrNull(record.businessPhone),
    whatsapp: textOrNull(record.whatsapp) ?? textOrNull(record.whatsappBusiness),
    socialAccounts: socialAccountsFrom(record).filter((item) => !/whatsapp|wa\.me/i.test(item)),
    catalogUrl: textOrNull(record.catalogUrl) ?? textOrNull(record.productPage),
    orderingChannel: textOrNull(record.orderingChannel) ?? textOrNull(record.orderingUrl),
    address: textOrNull(record.address),
    platforms: platforms ?? textList(record.platforms),
  };
}

const VISUAL_SHOT_CATEGORIES: Array<{ name: string; pattern: RegExp }> = [
  { name: "close-up", pattern: /close-?up|特写/i },
  { name: "hands", pattern: /\bhands?\b|手部|tangan/i },
  { name: "ribbon", pattern: /ribbon|丝带|reben/i },
  { name: "packaging", pattern: /packag|包装|bungkus/i },
  { name: "reveal", pattern: /reveal|揭晓|dedah/i },
  { name: "arranging", pattern: /arrang|插花|整理|menyusun/i },
  { name: "petal", pattern: /petal|花瓣|kelopak/i },
];

function visualShotCount(texts: string[]): number {
  const blob = texts.join("\n");
  return VISUAL_SHOT_CATEGORIES.filter((category) => category.pattern.test(blob)).length;
}

function spokenSentences(text: string): string[] {
  return text.split(/[.!?。！？]/).map((item) => item.trim()).filter((item) => item.length > 8);
}

function assessScriptDuration(
  contentPackage: MarketingContentPackage,
  facts: ContentContractFacts,
  codes: string[],
  fields: string[],
  issues: MarketingContractIssue[]
) {
  const duration = facts.durationSec;
  if (duration !== 15 && duration !== 30 && duration !== 60) return;
  const slot = `${duration}s` as "15s" | "30s" | "60s";
  const script = contentPackage.voiceScripts[slot]?.trim() ?? "";
  if (!script) return;
  const spoken = estimateSpokenSeconds(script);
  const visual = explicitVisualSeconds([...contentPackage.broll, ...contentPackage.effects]);
  const covered = spoken.seconds + visual;
  if (spoken.seconds > duration * MARKETING_SPEECH_RATES.maximumSpeechRatio) {
    codes.push("SCRIPT_SPEECH_TOO_LONG");
    fields.push(`voiceScripts.${slot}`);
    issues.push({
      code: "SCRIPT_SPEECH_TOO_LONG",
      field: `voiceScripts.${slot}`,
      expected: `spoken time within ${duration} seconds`,
      received: `${spoken.seconds.toFixed(1)}s speech`,
      normalizable: false,
    });
  } else if (covered < duration * MARKETING_SPEECH_RATES.minimumCoveredRatio) {
    codes.push("SCRIPT_DURATION_SHORT");
    fields.push(`voiceScripts.${slot}`);
    issues.push({
      code: "SCRIPT_DURATION_SHORT",
      field: `voiceScripts.${slot}`,
      expected: `${duration}s covered by speech or explicit visual seconds`,
      received: `${spoken.seconds.toFixed(1)}s speech and ${visual.toFixed(1)}s explicit visuals`,
      normalizable: false,
    });
  }
  const timelineEnd = contentPackage.subtitleTimeline.reduce((end, cue) => Math.max(end, cue.endSec), 0);
  if (timelineEnd > 0 && timelineEnd + 1 < duration && visual < duration - timelineEnd) {
    codes.push("SCRIPT_TIMELINE_SHORT");
    fields.push("subtitleTimeline");
    issues.push({
      code: "SCRIPT_TIMELINE_SHORT",
      field: "subtitleTimeline",
      expected: `cues or explicit visuals covering ${duration} seconds`,
      received: `timeline ends at ${timelineEnd}s`,
      normalizable: false,
    });
  }
  const sentences = spokenSentences(script);
  const repeated = sentences.some((sentence) => sentences.filter((item) => item === sentence).length >= 3);
  if (repeated) {
    codes.push("SCRIPT_FILLER");
    fields.push(`voiceScripts.${slot}`);
    issues.push({
      code: "SCRIPT_FILLER",
      field: `voiceScripts.${slot}`,
      expected: "no sentence repeated to fill the duration",
      received: "repeated sentence",
      normalizable: false,
    });
  }
}

function assessCreativeQuality(
  contentPackage: MarketingContentPackage,
  facts: ContentContractFacts,
  unsupported: boolean
): CreativeQualityReport {
  const duration = facts.durationSec === 15 || facts.durationSec === 30 || facts.durationSec === 60
    ? facts.durationSec
    : 30;
  const script = contentPackage.voiceScripts[`${duration}s`] || contentPackage.voiceScripts["30s"] || "";
  const hook = contentPackage.hooks[0]?.text ?? "";
  const productNamed = /bouquet|flower|花束|鲜花|bunga/i.test(`${hook}\n${script}`);
  const hookSpecific = /bouquet|flower|petal|花束|鲜花|花瓣|bunga|kelopak/i.test(hook);
  const sentences = spokenSentences(script);
  const shots = visualShotCount([...contentPackage.broll, ...contentPackage.effects]);
  const visualText = [...contentPackage.broll, ...contentPackage.effects].join(" ").trim();
  const leaked = isMarketingInstructionLeak(script);
  const repeated = sentences.some((sentence) => sentences.filter((item) => item === sentence).length >= 3);
  const dimensions: CreativeQualityReport["dimensions"] = [
    {
      name: "hook",
      score: hookSpecific ? 4 : hook.trim() ? 2 : null,
      basis: "deterministic",
      evidence: hookSpecific ? "Hook names a concrete product detail." : "Hook has no concrete product noun.",
    },
    {
      name: "storyProgression",
      score: sentences.length >= 3 ? 4 : sentences.length >= 1 && productNamed ? 3 : 2,
      basis: "deterministic",
      evidence: `${sentences.length} spoken sentence(s). This counts structure, not dramatic quality.`,
    },
    {
      name: "productClarity",
      score: productNamed ? 5 : 2,
      basis: "deterministic",
      evidence: productNamed ? "The requested script names the authorized product." : "The requested script does not name the product.",
    },
    {
      name: "commercialRelevance",
      score: unsupported ? 1 : contentPackage.cta.some((item) => item.text.trim()) ? 4 : 2,
      basis: "deterministic",
      evidence: unsupported ? "A required line asserts an unauthorized commercial fact." : "CTA is present and no unauthorized commercial fact was detected.",
    },
    {
      name: "visualExecutability",
      score: visualText ? (shots >= 3 ? 4 : shots === 2 ? 3 : 2) : null,
      basis: "deterministic",
      evidence: visualText
        ? `${shots} feasible shot categor${shots === 1 ? "y" : "ies"} in suggested visuals.`
        : "No suggested shots were provided, so visual executability was not scored.",
    },
    {
      name: "languageNaturalness",
      score: leaked || repeated ? 2 : script.trim() ? 3 : null,
      basis: "structural",
      evidence: leaked || repeated
        ? "Instruction text or a repeated filler sentence is present."
        : "No instruction leak or repeated filler sentence. Naturalness was not scored by a model.",
    },
    {
      name: "businessGrounding",
      score: unsupported ? 1 : 5,
      basis: "deterministic",
      evidence: unsupported ? "Unsupported factual claim in required copy." : "No unsupported factual claim in required copy.",
    },
  ];
  const missing = dimensions.some((dimension) => dimension.score == null);
  const total = missing ? null : dimensions.reduce((sum, dimension) => sum + (dimension.score ?? 0), 0);
  const product = dimensions.find((dimension) => dimension.name === "productClarity")?.score ?? 0;
  const grounding = dimensions.find((dimension) => dimension.name === "businessGrounding")?.score ?? 0;
  const below = dimensions.some((dimension) => dimension.score != null && dimension.score < 3);
  let status: CreativeQualityStatus = "PASS";
  if (unsupported || below || (product != null && product < 4) || (grounding != null && grounding < 4) || (total != null && total < 28)) status = "FAIL";
  else if (missing) status = "REQUIRES_CREATIVE_REVIEW";
  return { status, total, maxScore: 35, dimensions };
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
  adjustments: MarketingContractAdjustment[],
  issues?: MarketingContractIssue[]
): unknown {
  if (!Array.isArray(items)) return items;
  const kept: unknown[] = [];
  for (const item of items) {
    if (typeof item !== "string") {
      kept.push(item);
      continue;
    }
    const hits = claimMatches(item, facts);
    if (hits.length === 0) {
      kept.push(item);
      continue;
    }
    adjustments.push({ field, action: "remove", raw: item });
    issues?.push({
      code: "UNSUPPORTED_CLAIM",
      field,
      expected: "authorized business fact",
      received: "string",
      claimCategory: hits[0].category,
      normalizable: true,
      excerpt: item.trim().slice(0, 80),
      authorization: "business_profile",
    });
  }
  return kept;
}

function channelMatches(
  text: string,
  facts: ContentContractFacts
): Array<{ category: MarketingClaimCategory; excerpt: string; action: MarketingCtaAction }> {
  return unauthorizedCtaHits(text, resolveMarketingCtaAuthority(facts)).map((hit) => ({
    category: "channel" as const,
    excerpt: hit.excerpt,
    action: hit.action,
  }));
}

function rejectProseClaims(
  field: string,
  value: unknown,
  facts: ContentContractFacts,
  codes: string[],
  fields: string[],
  issues?: MarketingContractIssue[],
  includeChannels = false
) {
  if (typeof value !== "string" || !value.trim()) return;
  const claimHits = claimMatches(value, facts);
  const channelHits = includeChannels ? channelMatches(value, facts) : [];
  if (claimHits.length === 0 && channelHits.length === 0) return;
  if (claimHits.length) codes.push("UNSUPPORTED_CLAIM");
  if (channelHits.length) codes.push(includeChannels ? "CONTENT_CTA_UNAUTHORIZED" : "UNSUPPORTED_CLAIM");
  fields.push(field);
  for (const hit of claimHits) {
    issues?.push({
      code: "UNSUPPORTED_CLAIM",
      field,
      expected: "authorized business fact",
      received: "string",
      claimCategory: hit.category,
      normalizable: false,
      excerpt: hit.excerpt,
      authorization: "business_profile",
    });
  }
  for (const hit of channelHits) {
    issues?.push({
      code: "CONTENT_CTA_UNAUTHORIZED",
      field,
      expected: "an action in the current CTA authority",
      received: hit.action,
      claimCategory: hit.category,
      normalizable: false,
      excerpt: hit.excerpt,
      authorization: "business_profile",
    });
  }
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
  const issues: MarketingContractIssue[] = [];
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
  data.keywords = stripOptionalClaims(data.keywords, "keywords", facts, adjustments, issues);
  data.brandPersonality = stripOptionalClaims(data.brandPersonality, "brandPersonality", facts, adjustments, issues);
  if (data.hashtags && typeof data.hashtags === "object" && !Array.isArray(data.hashtags)) {
    const hashtags = { ...(data.hashtags as Record<string, unknown>) };
    for (const key of ["industry", "local", "trending", "seo"]) {
      hashtags[key] = stripOptionalClaims(hashtags[key], `hashtags.${key}`, facts, adjustments, issues);
    }
    data.hashtags = hashtags;
  }
  for (const field of ["industry", "businessType", "product", "marketingGoal", "marketingAngle", "tone", "videoStyle", "customerJourney", "ctaStrategy"]) {
    rejectProseClaims(field, data[field], facts, codes, fields, issues);
  }
  if (typeof data.ctaStrategy === "string") {
    const ctaGate = strategyCtaAllowsContent(data.ctaStrategy, facts);
    if (!ctaGate.ok) {
      codes.push("STRATEGY_CTA_UNAUTHORIZED");
      fields.push("ctaStrategy");
      issues.push(...ctaGate.issues);
    }
  }
  const audience = data.audience && typeof data.audience === "object" && !Array.isArray(data.audience)
    ? data.audience as Record<string, unknown>
    : null;
  if (audience) {
    for (const field of ["desiredOutcome", "buyingIntent", "location"]) {
      rejectProseClaims(`audience.${field}`, audience[field], facts, codes, fields, issues);
    }
    for (const field of ["interests", "painPoints"]) {
      const items = audience[field];
      if (!Array.isArray(items)) continue;
      items.forEach((item, index) => {
        if (typeof item !== "string") return;
        rejectProseClaims(`audience.${field}[${index}]`, item, facts, codes, fields, issues);
      });
    }
  }
  const parsed = StrategyPlanSchema.safeParse(data);
  if (!parsed.success) {
    const schemaFields = issueFields(parsed.error).filter((field) => !fields.includes(field));
    if (schemaFields.length) {
      codes.push("STRATEGY_SCHEMA_INVALID");
      fields.push(...schemaFields);
    }
    return { diagnostic: diagnostic("strategy", codes, fields, adjustments, issues), plan: null };
  }
  if (codes.length) return { diagnostic: diagnostic("strategy", codes, fields, adjustments, issues), plan: null };
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
  if (codes.length > 0) return { diagnostic: diagnostic("strategy", codes, fields, adjustments, issues), plan: null };
  return { diagnostic: diagnostic("strategy", [], [], adjustments, issues), plan: parsed.data };
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

const TIME_TOKEN = /^(-?\d+(?:\.\d+)?)s$/i;
const CLOCK_TOKEN = /^(\d{1,2}):([0-5]\d)(?:\.(\d{1,3}))?$/;

function finiteDuration(value: number | null | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  return value;
}

function parseTimeToken(value: unknown): { ok: true; seconds: number } | { ok: false; received: string } {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return { ok: false, received: String(value) };
    return { ok: true, seconds: value };
  }
  if (typeof value !== "string") return { ok: false, received: value == null ? "missing" : typeof value };
  const text = value.trim();
  const seconds = TIME_TOKEN.exec(text);
  if (seconds) {
    const parsed = Number(seconds[1]);
    if (!Number.isFinite(parsed)) return { ok: false, received: text };
    return { ok: true, seconds: parsed };
  }
  const clock = CLOCK_TOKEN.exec(text);
  if (clock) {
    const fraction = clock[3] ? Number(clock[3]) / 10 ** clock[3].length : 0;
    return { ok: true, seconds: Number(clock[1]) * 60 + Number(clock[2]) + fraction };
  }
  return { ok: false, received: text || "empty" };
}

function timelineIssue(
  code: string,
  field: string,
  expected: string,
  received: string
): MarketingContractIssue {
  const nonFinite = received === "NaN" || received === "Infinity" || received === "-Infinity";
  return { code: nonFinite ? "TIMELINE_NON_FINITE" : code, field, expected, received, normalizable: false };
}

export function normalizeSubtitleTimeline(
  raw: unknown,
  durationSec?: number | null
): { ok: true; timeline: Array<{ startSec: number; endSec: number; text: string; role?: string }> } | { ok: false; issues: MarketingContractIssue[] } {
  if (raw == null) return { ok: true, timeline: [] };
  if (!Array.isArray(raw)) {
    return { ok: false, issues: [timelineIssue("TIMELINE_MALFORMED", "subtitleTimeline", "array", typeof raw)] };
  }
  const duration = finiteDuration(durationSec);
  const issues: MarketingContractIssue[] = [];
  const cues: Array<{ index: number; start: number; end?: number; text: string; role?: string }> = [];
  raw.forEach((entry, index) => {
    const field = `subtitleTimeline[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      issues.push(timelineIssue("TIMELINE_MALFORMED", field, "object", typeof entry));
      return;
    }
    const record = entry as Record<string, unknown>;
    const text = typeof record.text === "string" ? record.text : "";
    if (!text.trim()) {
      issues.push(timelineIssue("TIMELINE_TEXT_EMPTY", `${field}.text`, "non-empty string", text ? "blank" : "empty"));
      return;
    }
    const canonical = typeof record.startSec === "number" && typeof record.endSec === "number";
    const startParsed = canonical ? parseTimeToken(record.startSec) : parseTimeToken(record.time ?? record.startSec ?? record.start);
    if (!startParsed.ok) {
      issues.push(timelineIssue("TIMELINE_TIME_UNPARSEABLE", `${field}.startSec`, "number | 0s | 2.5s | MM:SS | MM:SS.mmm", startParsed.received));
      return;
    }
    if (startParsed.seconds < 0) {
      issues.push(timelineIssue("TIMELINE_NEGATIVE", `${field}.startSec`, "non-negative seconds", String(startParsed.seconds)));
      return;
    }
    let end: number | undefined;
    if (canonical) {
      const endParsed = parseTimeToken(record.endSec);
      if (!endParsed.ok || endParsed.seconds < 0) {
        issues.push(timelineIssue(endParsed.ok ? "TIMELINE_NEGATIVE" : "TIMELINE_TIME_UNPARSEABLE", `${field}.endSec`, "non-negative number", endParsed.ok ? String(endParsed.seconds) : endParsed.received));
        return;
      }
      end = endParsed.seconds;
    }
    cues.push({
      index,
      start: startParsed.seconds,
      end,
      text,
      ...(typeof record.role === "string" ? { role: record.role } : {}),
    });
  });
  if (issues.length) return { ok: false, issues };
  for (let index = 1; index < cues.length; index += 1) {
    if (cues[index].start <= cues[index - 1].start) {
      issues.push(timelineIssue("TIMELINE_NON_MONOTONIC", `subtitleTimeline[${cues[index].index}].startSec`, "strictly later than the previous cue", String(cues[index].start)));
    }
  }
  if (issues.length) return { ok: false, issues };
  cues.forEach((cue, index) => {
    if (cue.end != null) return;
    const next = cues[index + 1];
    if (next) {
      cue.end = next.start;
      return;
    }
    if (duration != null && duration >= cue.start) {
      cue.end = duration;
      return;
    }
    if (duration != null) {
      issues.push(timelineIssue("TIMELINE_BEYOND_DURATION", `subtitleTimeline[${cue.index}].startSec`, `within ${duration} seconds`, String(cue.start)));
      return;
    }
    issues.push(timelineIssue("TIMELINE_END_UNBOUNDED", `subtitleTimeline[${cue.index}].endSec`, "next start or explicit duration", "missing"));
  });
  if (issues.length) return { ok: false, issues };
  const timeline = cues.map((cue) => {
    const end = cue.end as number;
    const field = `subtitleTimeline[${cue.index}]`;
    if (end <= cue.start) issues.push(timelineIssue("TIMELINE_ZERO_DURATION", `${field}.endSec`, "later than startSec", String(end)));
    if (duration != null && (cue.start > duration || end > duration + 1e-6)) {
      issues.push(timelineIssue("TIMELINE_BEYOND_DURATION", `${field}.endSec`, `within ${duration} seconds`, String(end)));
    }
    for (const earlier of cues) {
      if (earlier.index >= cue.index || earlier.end == null) continue;
      if (cue.start < earlier.end) {
        issues.push(timelineIssue("TIMELINE_OVERLAP", `${field}.startSec`, "at or after the previous endSec", String(cue.start)));
      }
    }
    return { startSec: cue.start, endSec: end, text: cue.text, ...(cue.role ? { role: cue.role } : {}) };
  });
  if (issues.length) return { ok: false, issues };
  return { ok: true, timeline };
}

function schemaIssues(issues: Array<{ path: PropertyKey[]; message: string }>): MarketingContractIssue[] {
  return issues.slice(0, 12).map((issue) => ({
    code: "CONTENT_SCHEMA_INVALID",
    field: issue.path.reduce<string>((path, part) => {
      if (typeof part === "number") return `${path}[${part}]`;
      const key = String(part);
      return path ? `${path}.${key}` : key;
    }, "") || "body",
    expected: "canonical content field",
    received: issue.message,
    normalizable: false,
  }));
}

function stripContentOptionalClaims(
  payload: Record<string, unknown>,
  facts: StrategyContractFacts,
  adjustments: MarketingContractAdjustment[],
  issues: MarketingContractIssue[]
) {
  const assets = payload.platformAssets;
  if (assets && typeof assets === "object" && !Array.isArray(assets)) {
    for (const [platform, asset] of Object.entries(assets as Record<string, unknown>)) {
      if (!asset || typeof asset !== "object" || Array.isArray(asset)) continue;
      const record = asset as Record<string, unknown>;
      record.hashtags = stripOptionalClaims(record.hashtags, `platformAssets.${platform}.hashtags`, facts, adjustments, issues);
    }
  }
  const pack = payload.hashtagPack;
  if (pack && typeof pack === "object" && !Array.isArray(pack)) {
    const record = pack as Record<string, unknown>;
    for (const key of ["highVolume", "mediumVolume", "local", "brand", "industry"]) {
      record[key] = stripOptionalClaims(record[key], `hashtagPack.${key}`, facts, adjustments, issues);
    }
  }
  const seo = payload.seo;
  if (seo && typeof seo === "object" && !Array.isArray(seo)) {
    const record = seo as Record<string, unknown>;
    for (const key of ["primaryKeywords", "secondaryKeywords", "longTailKeywords", "localKeywords"]) {
      record[key] = stripOptionalClaims(record[key], `seo.${key}`, facts, adjustments, issues);
    }
  }
}

function pushClaim(
  field: string,
  value: unknown,
  facts: ContentContractFacts,
  codes: string[],
  fields: string[],
  issues: MarketingContractIssue[]
) {
  rejectProseClaims(field, value, facts, codes, fields, issues, true);
}

function scanContentClaims(
  contentPackage: MarketingContentPackage,
  payload: Record<string, unknown>,
  facts: ContentContractFacts,
  codes: string[],
  fields: string[],
  issues: MarketingContractIssue[]
) {
  for (const key of ["15s", "30s", "60s"] as const) {
    pushClaim(`voiceScripts.${key}`, contentPackage.voiceScripts[key], facts, codes, fields, issues);
    pushClaim(`voiceScriptsEn.${key}`, contentPackage.voiceScriptsEn?.[key], facts, codes, fields, issues);
    pushClaim(`voiceScriptsZh.${key}`, contentPackage.voiceScriptsZh?.[key], facts, codes, fields, issues);
  }
  contentPackage.hooks.forEach((hook, index) => {
    pushClaim(`hooks[${index}].text`, hook.text, facts, codes, fields, issues);
    pushClaim(`hooks[${index}].textEn`, hook.textEn, facts, codes, fields, issues);
    pushClaim(`hooks[${index}].textMs`, hook.textMs, facts, codes, fields, issues);
  });
  contentPackage.cta.forEach((item, index) => {
    pushClaim(`cta[${index}].text`, item.text, facts, codes, fields, issues);
    pushClaim(`cta[${index}].textEn`, item.textEn, facts, codes, fields, issues);
    pushClaim(`cta[${index}].textMs`, item.textMs, facts, codes, fields, issues);
  });
  for (const [platform, caption] of Object.entries(contentPackage.captions ?? {})) {
    pushClaim(`captions.${platform}`, caption, facts, codes, fields, issues);
  }
  for (const [platform, caption] of Object.entries(contentPackage.captionsEn ?? {})) {
    pushClaim(`captionsEn.${platform}`, caption, facts, codes, fields, issues);
  }
  for (const [platform, caption] of Object.entries(contentPackage.captionsMs ?? {})) {
    pushClaim(`captionsMs.${platform}`, caption, facts, codes, fields, issues);
  }
  contentPackage.subtitleTimeline.forEach((cue, index) => {
    pushClaim(`subtitleTimeline[${index}].text`, cue.text, facts, codes, fields, issues);
  });
  contentPackage.broll.forEach((item, index) => pushClaim(`broll[${index}]`, item, facts, codes, fields, issues));
  contentPackage.effects.forEach((item, index) => pushClaim(`effects[${index}]`, item, facts, codes, fields, issues));
  const posting = contentPackage.postingRecommendation;
  for (const key of ["bestPostingTime", "bestPlatform", "idealAudience", "estimatedEngagement"] as const) {
    pushClaim(`postingRecommendation.${key}`, posting?.[key], facts, codes, fields, issues);
  }
  if (typeof payload.postingRecommendation === "string") {
    pushClaim("postingRecommendation", payload.postingRecommendation, facts, codes, fields, issues);
  }
  const brief = contentPackage.strategyBrief;
  if (brief) {
    for (const key of ["primaryGoal", "targetAudience", "contentAngle", "painPoint", "desiredEmotion", "ctaStrategy"] as const) {
      pushClaim(`strategyBrief.${key}`, brief[key], facts, codes, fields, issues);
    }
  }
  for (const [platform, asset] of Object.entries(contentPackage.platformAssets ?? {})) {
    if (!asset) continue;
    for (const key of ["caption", "hook", "title", "description", "cta"] as const) {
      pushClaim(`platformAssets.${platform}.${key}`, asset[key], facts, codes, fields, issues);
    }
  }
  contentPackage.aiSuggestions.forEach((item, index) => {
    pushClaim(`aiSuggestions[${index}]`, item, facts, codes, fields, issues);
  });
}

export function evaluateContentContract(
  raw: unknown,
  facts: ContentContractFacts = {}
): { diagnostic: MarketingContractDiagnostic; contentPackage: MarketingContentPackage | null } {
  if (typeof raw === "string") {
    return { diagnostic: diagnostic("content", ["CONTENT_JSON_TRUNCATED"], ["body"], [], [], facts.providerRequestId), contentPackage: null };
  }
  const payload = unwrapMarketingContentPayload(raw);
  if (!payload) {
    return { diagnostic: diagnostic("content", ["CONTENT_SCHEMA_INVALID"], ["body"], [], [], facts.providerRequestId), contentPackage: null };
  }
  const codes: string[] = [];
  const fields: string[] = [];
  const adjustments: MarketingContractAdjustment[] = [];
  const issues: MarketingContractIssue[] = [];
  if ("subtitleTimeline" in payload) {
    const timeline = normalizeSubtitleTimeline(payload.subtitleTimeline, facts.durationSec);
    if (!timeline.ok) {
      return {
        diagnostic: diagnostic(
          "content",
          ["CONTENT_SCHEMA_INVALID", ...timeline.issues.map((issue) => issue.code)],
          timeline.issues.map((issue) => issue.field),
          [],
          timeline.issues,
          facts.providerRequestId
        ),
        contentPackage: null,
      };
    }
    payload.subtitleTimeline = timeline.timeline;
  }
  stripContentOptionalClaims(payload, facts, adjustments, issues);
  const parsedIssues: Array<{ path: PropertyKey[]; message: string }> = [];
  const contentPackage = normalizeMarketingContentPackage(payload, parsedIssues);
  if (!contentPackage) {
    codes.push("CONTENT_SCHEMA_INVALID");
    const hooks = payload.hooks ?? payload.hookList ?? payload.hook;
    const cta = payload.cta ?? payload.ctas ?? payload.callToAction;
    if (!hooks || (Array.isArray(hooks) && hooks.length === 0)) {
      codes.push("HOOKS_MISSING");
      fields.push("hooks");
      issues.push({ code: "HOOKS_MISSING", field: "hooks", expected: "non-empty array", received: "missing", normalizable: false });
    }
    if (!cta || (Array.isArray(cta) && cta.length === 0)) {
      codes.push("CTA_MISSING");
      fields.push("cta");
      issues.push({ code: "CTA_MISSING", field: "cta", expected: "non-empty array", received: "missing", normalizable: false });
    }
    if (!String(payload.musicMood ?? payload.music_mood ?? "").trim()) {
      codes.push("MUSIC_MOOD_MISSING");
      fields.push("musicMood");
      issues.push({ code: "MUSIC_MOOD_MISSING", field: "musicMood", expected: "string", received: "missing", normalizable: false });
    }
    for (const issue of schemaIssues(parsedIssues)) {
      if (fields.includes(issue.field)) continue;
      fields.push(issue.field);
      issues.push(issue);
    }
    return { diagnostic: diagnostic("content", codes, fields, adjustments, issues, facts.providerRequestId), contentPackage: null };
  }
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
  scanContentClaims(contentPackage, payload, facts, codes, fields, issues);
  assessScriptDuration(contentPackage, facts, codes, fields, issues);
  const quality = assessCreativeQuality(contentPackage, facts, codes.includes("UNSUPPORTED_CLAIM"));
  if (codes.length > 0) {
    return {
      diagnostic: diagnostic("content", codes, fields, adjustments, issues, facts.providerRequestId, quality),
      contentPackage: null,
    };
  }
  return {
    diagnostic: diagnostic("content", [], [], adjustments, issues, facts.providerRequestId, quality),
    contentPackage,
  };
}

export function contentAllowsTranslation(contentPackage: MarketingContentPackage | null | undefined): boolean {
  if (!contentPackage) return false;
  return evaluateContentContract(contentPackage).diagnostic.ok;
}

export function contentIsCommerciallyReady(result: {
  diagnostic: MarketingContractDiagnostic;
  contentPackage: MarketingContentPackage | null;
}): boolean {
  return Boolean(result.contentPackage) && result.diagnostic.ok && result.diagnostic.quality?.status === "PASS";
}
