import { z } from "zod";

/** Reasonable caps for AI-suggested tag lists (PD-013). */
export const BUSINESS_PROFILE_AI_LIMITS = {
  brandPersonality: 8,
  brandTone: 6,
  brandKeywords: 12,
  targetAudience: 8,
  brandSummaryMaxChars: 280,
} as const;

const ANALYSIS_SOURCE_KEYS = [
  "companyName",
  "industry",
  "businessDescription",
  "services",
  "website",
  "socialMedia",
  "logo",
  "brandColors",
  "existingKeywords",
  "existingAudience",
  "existingPersonality",
] as const;

export type BusinessProfileAiSourceKey = (typeof ANALYSIS_SOURCE_KEYS)[number];

export const BusinessProfileAiAnalysisSchema = z.object({
  brandSummary: z.string().trim().min(1),
  brandPersonality: z.array(z.string().trim().min(1)).min(1),
  brandTone: z.array(z.string().trim().min(1)).min(1),
  brandKeywords: z.array(z.string().trim().min(1)).min(1),
  targetAudience: z.array(z.string().trim().min(1)).min(1),
});

export type BusinessProfileAiAnalysis = z.infer<typeof BusinessProfileAiAnalysisSchema>;

export const BusinessProfileAiAnalyzeRequestSchema = z
  .object({
    companyName: z.string().trim().optional().nullable(),
    industryId: z.string().trim().optional().nullable(),
    industryDisplayName: z.string().trim().optional().nullable(),
    industryCustomValue: z.string().trim().optional().nullable(),
    services: z.array(z.string().trim()).optional(),
    businessDescription: z.string().trim().optional().nullable(),
    targetAudience: z.string().trim().optional().nullable(),
    website: z.string().trim().optional().nullable(),
    facebook: z.string().trim().optional().nullable(),
    instagram: z.string().trim().optional().nullable(),
    tiktok: z.string().trim().optional().nullable(),
    youtube: z.string().trim().optional().nullable(),
    redNote: z.string().trim().optional().nullable(),
    linkedIn: z.string().trim().optional().nullable(),
    logo: z.string().trim().optional().nullable(),
    brandColors: z.array(z.string().trim()).optional(),
    brandKeywords: z.array(z.string().trim()).optional(),
    brandPersonality: z.array(z.string().trim()).optional(),
    country: z.string().trim().optional().nullable(),
  })
  .passthrough();

export type BusinessProfileAiAnalyzeRequest = z.infer<typeof BusinessProfileAiAnalyzeRequestSchema>;

export interface BusinessProfileAiMeta {
  confidence: number;
  sourcesUsed: BusinessProfileAiSourceKey[];
  missingSources: BusinessProfileAiSourceKey[];
}

function normalizeList(values: unknown, max: number): string[] {
  if (!Array.isArray(values)) {
    if (typeof values === "string" && values.trim()) {
      return normalizeList(
        values
          .split(/[,;\n|/]+/)
          .map((s) => s.trim())
          .filter(Boolean),
        max
      );
    }
    return [];
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim().replace(/\s+/g, " ");
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= max) break;
  }
  return out;
}

function pickSummary(raw: Record<string, unknown>): string {
  const candidates = [raw.brandSummary, raw.summary, raw.positioning, raw.businessSummary];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim().replace(/\s+/g, " ").slice(0, BUSINESS_PROFILE_AI_LIMITS.brandSummaryMaxChars);
    }
  }
  return "";
}

/** Normalize provider JSON into the public AI analysis shape. */
export function normalizeBusinessProfileAiAnalysis(raw: unknown): BusinessProfileAiAnalysis {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  const brandSummary = pickSummary(obj);
  const brandPersonality = normalizeList(
    obj.brandPersonality ?? obj.personality ?? obj.brandVoice,
    BUSINESS_PROFILE_AI_LIMITS.brandPersonality
  );
  const brandTone = normalizeList(obj.brandTone ?? obj.tone, BUSINESS_PROFILE_AI_LIMITS.brandTone);
  const brandKeywords = normalizeList(
    obj.brandKeywords ?? obj.keywords,
    BUSINESS_PROFILE_AI_LIMITS.brandKeywords
  );
  const targetAudience = normalizeList(
    obj.targetAudience ?? obj.audience ?? obj.targetAudiences,
    BUSINESS_PROFILE_AI_LIMITS.targetAudience
  );

  const parsed = BusinessProfileAiAnalysisSchema.safeParse({
    brandSummary,
    brandPersonality,
    brandTone,
    brandKeywords,
    targetAudience,
  });

  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid AI analysis";
    throw new Error(message);
  }

  return parsed.data;
}

export function validateBusinessProfileAiAnalysis(
  analysis: BusinessProfileAiAnalysis
): { ok: true; analysis: BusinessProfileAiAnalysis } | { ok: false; message: string } {
  try {
    return { ok: true, analysis: normalizeBusinessProfileAiAnalysis(analysis) };
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
}

function hasText(value: string | null | undefined): boolean {
  return Boolean(value?.trim());
}

function hasItems(values: string[] | null | undefined): boolean {
  return Boolean(values?.some((v) => v.trim()));
}

function hasSocial(input: BusinessProfileAiAnalyzeRequest): boolean {
  return [
    input.facebook,
    input.instagram,
    input.tiktok,
    input.youtube,
    input.redNote,
    input.linkedIn,
  ].some((v) => hasText(v));
}

/** Derive confidence + source explainability from available business context. */
export function assessBusinessProfileAiSources(
  input: BusinessProfileAiAnalyzeRequest
): BusinessProfileAiMeta {
  const checks: Array<{ key: BusinessProfileAiSourceKey; present: boolean }> = [
    { key: "companyName", present: hasText(input.companyName) },
    {
      key: "industry",
      present:
        hasText(input.industryDisplayName) ||
        hasText(input.industryCustomValue) ||
        hasText(input.industryId),
    },
    { key: "businessDescription", present: hasText(input.businessDescription) },
    { key: "services", present: hasItems(input.services) },
    { key: "website", present: hasText(input.website) },
    { key: "socialMedia", present: hasSocial(input) },
    { key: "logo", present: hasText(input.logo) },
    { key: "brandColors", present: hasItems(input.brandColors) },
    { key: "existingKeywords", present: hasItems(input.brandKeywords) },
    { key: "existingAudience", present: hasText(input.targetAudience) },
    { key: "existingPersonality", present: hasItems(input.brandPersonality) },
  ];

  const sourcesUsed = checks.filter((c) => c.present).map((c) => c.key);
  const missingSources = checks.filter((c) => !c.present).map((c) => c.key);
  const confidence = Math.round((sourcesUsed.length / checks.length) * 100);

  return { confidence, sourcesUsed, missingSources };
}

/** Map accepted AI analysis onto Business Profile update fields (SPEC-001 columns). */
export function businessProfileAiAnalysisToUpdate(analysis: BusinessProfileAiAnalysis): {
  businessDescription: string;
  brandPersonality: string[];
  brandKeywords: string[];
  targetAudience: string;
} {
  const normalized = normalizeBusinessProfileAiAnalysis(analysis);
  const brandPersonality = normalizeList(
    [...normalized.brandPersonality, ...normalized.brandTone],
    BUSINESS_PROFILE_AI_LIMITS.brandPersonality + BUSINESS_PROFILE_AI_LIMITS.brandTone
  );

  return {
    businessDescription: normalized.brandSummary,
    brandPersonality,
    brandKeywords: normalized.brandKeywords,
    targetAudience: normalized.targetAudience.join(", "),
  };
}
