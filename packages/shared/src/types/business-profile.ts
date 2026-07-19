import { z } from "zod";
import type { BrandProfile } from "./index";
import { BusinessHoursSchema, normalizeBusinessHours, type BusinessHours } from "../business-profile/business-hours";
import {
  hasIndustryValue,
  resolveIndustryLabel,
  INDUSTRY_CUSTOM_ID,
} from "../dictionaries/industry-dictionary";

const optionalUrl = z
  .string()
  .trim()
  .optional()
  .refine((v) => !v || /^https?:\/\/.+/i.test(v), {
    message: "Must be a complete URL (https://...)",
  });

export const BusinessProfileIndustrySchema = z.object({
  industryId: z.string().trim().nullable().optional(),
  industryDisplayName: z.string().trim().nullable().optional(),
  industryCustomValue: z.string().trim().nullable().optional(),
});

export const BusinessProfileRecordSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  companyName: z.string().trim().nullable().optional(),
  industryId: z.string().trim().nullable().optional(),
  industryDisplayName: z.string().trim().nullable().optional(),
  industryCustomValue: z.string().trim().nullable().optional(),
  services: z.array(z.string().trim()).default([]),
  businessDescription: z.string().trim().nullable().optional(),
  targetAudience: z.string().trim().nullable().optional(),
  businessHours: BusinessHoursSchema.default([]),
  businessEmail: z.string().trim().nullable().optional(),
  businessPhone: z.string().trim().nullable().optional(),
  whatsappBusiness: optionalUrl.nullable().optional(),
  website: optionalUrl.nullable().optional(),
  facebook: optionalUrl.nullable().optional(),
  instagram: optionalUrl.nullable().optional(),
  tiktok: optionalUrl.nullable().optional(),
  youtube: optionalUrl.nullable().optional(),
  redNote: optionalUrl.nullable().optional(),
  linkedIn: optionalUrl.nullable().optional(),
  country: z.string().trim().nullable().optional(),
  stateProvince: z.string().trim().nullable().optional(),
  city: z.string().trim().nullable().optional(),
  address: z.string().trim().nullable().optional(),
  postalCode: z.string().trim().nullable().optional(),
  timezone: z.string().trim().nullable().optional(),
  brandPersonality: z.array(z.string().trim()).default([]),
  brandStyle: z.array(z.string().trim()).default([]),
  brandValues: z.array(z.string().trim()).default([]),
  brandKeywords: z.array(z.string().trim()).default([]),
  logo: z.string().trim().nullable().optional(),
  brandColors: z.array(z.string().trim()).default([]),
  brandFonts: z.array(z.string().trim()).default([]),
  brandImages: z.array(z.string().trim()).default([]),
  supportedLanguages: z.array(z.string().trim()).default([]),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  createdBy: z.string().uuid().nullable().optional(),
  updatedBy: z.string().uuid().nullable().optional(),
  deletedAt: z.coerce.date().nullable().optional(),
  version: z.number().int().min(1),
});

export type BusinessProfileRecord = z.infer<typeof BusinessProfileRecordSchema>;

export const BusinessProfileUpdateSchema = z.object({
  companyName: z.string().trim().min(1).optional(),
  industryId: z.string().trim().nullable().optional(),
  industryDisplayName: z.string().trim().nullable().optional(),
  industryCustomValue: z.string().trim().nullable().optional(),
  services: z.array(z.string().trim().min(1)).min(1).optional(),
  businessDescription: z.string().trim().min(1).optional(),
  targetAudience: z.string().trim().min(1).optional(),
  businessHours: BusinessHoursSchema.optional(),
  businessEmail: z.string().trim().email().optional(),
  businessPhone: z.string().trim().min(1).optional(),
  whatsappBusiness: optionalUrl.nullable().optional(),
  website: optionalUrl.nullable().optional(),
  facebook: optionalUrl.nullable().optional(),
  instagram: optionalUrl.nullable().optional(),
  tiktok: optionalUrl.nullable().optional(),
  youtube: optionalUrl.nullable().optional(),
  redNote: optionalUrl.nullable().optional(),
  linkedIn: optionalUrl.nullable().optional(),
  country: z.string().trim().min(1).optional(),
  stateProvince: z.string().trim().optional().nullable(),
  city: z.string().trim().optional().nullable(),
  address: z.string().trim().min(1).optional(),
  postalCode: z.string().trim().min(1).optional(),
  timezone: z.string().trim().min(1).optional(),
  brandPersonality: z.array(z.string().trim().min(1)).optional(),
  brandStyle: z.array(z.string().trim().min(1)).optional(),
  brandValues: z.array(z.string().trim().min(1)).optional(),
  brandKeywords: z.array(z.string().trim().min(1)).min(1).optional(),
  logo: z.string().trim().optional().nullable(),
  brandColors: z.array(z.string().trim()).optional(),
  brandFonts: z.array(z.string().trim()).optional(),
  brandImages: z.array(z.string().trim()).optional(),
  supportedLanguages: z.array(z.string().trim().min(1)).optional(),
  version: z.number().int().min(1).optional(),
});

export type BusinessProfileUpdate = z.infer<typeof BusinessProfileUpdateSchema>;

export const BUSINESS_PROFILE_REQUIRED_FIELDS = [
  "companyName",
  "industry",
  "services",
  "businessDescription",
  "targetAudience",
  "businessEmail",
  "businessPhone",
  "country",
  "address",
  "postalCode",
  "brandKeywords",
] as const;

export type BusinessProfileRequiredField = (typeof BUSINESS_PROFILE_REQUIRED_FIELDS)[number];

export type BusinessProfileCardId =
  | "overview"
  | "contactLocation"
  | "brandIdentity"
  | "assets"
  | "languages"
  | "businessHours";

export interface BusinessProfileCompletionResult {
  complete: boolean;
  missing: BusinessProfileRequiredField[];
  percent: number;
  incompleteCards: BusinessProfileCardId[];
}

function hasText(value: string | null | undefined): boolean {
  return Boolean(value?.trim());
}

function hasItems(values: string[] | null | undefined): boolean {
  return Boolean(values?.some((v) => v.trim()));
}

type CompletionInput = Pick<
  BusinessProfileRecord,
  | "companyName"
  | "industryId"
  | "industryDisplayName"
  | "industryCustomValue"
  | "services"
  | "businessDescription"
  | "targetAudience"
  | "businessEmail"
  | "businessPhone"
  | "country"
  | "address"
  | "postalCode"
  | "brandKeywords"
>;

function fieldComplete(profile: CompletionInput, field: BusinessProfileRequiredField): boolean {
  switch (field) {
    case "companyName":
      return hasText(profile.companyName);
    case "industry":
      return hasIndustryValue(profile);
    case "services":
      return hasItems(profile.services);
    case "businessDescription":
      return hasText(profile.businessDescription);
    case "targetAudience":
      return hasText(profile.targetAudience);
    case "businessEmail":
      return hasText(profile.businessEmail);
    case "businessPhone":
      return hasText(profile.businessPhone);
    case "country":
      return hasText(profile.country);
    case "address":
      return hasText(profile.address);
    case "postalCode":
      return hasText(profile.postalCode);
    case "brandKeywords":
      return hasItems(profile.brandKeywords);
    default:
      return false;
  }
}

export function assessBusinessProfileCompletion(profile: CompletionInput): BusinessProfileCompletionResult {
  const missing = BUSINESS_PROFILE_REQUIRED_FIELDS.filter((field) => !fieldComplete(profile, field));
  const complete = missing.length === 0;
  const percent = Math.round(
    ((BUSINESS_PROFILE_REQUIRED_FIELDS.length - missing.length) / BUSINESS_PROFILE_REQUIRED_FIELDS.length) * 100
  );

  const incompleteCards: BusinessProfileCardId[] = [];
  if (
    missing.some((f) =>
      ["companyName", "industry", "services", "businessDescription", "targetAudience"].includes(f)
    )
  ) {
    incompleteCards.push("overview");
  }
  if (
    missing.some((f) =>
      ["businessEmail", "businessPhone", "country", "address", "postalCode"].includes(f)
    )
  ) {
    incompleteCards.push("contactLocation");
  }
  if (missing.includes("brandKeywords")) incompleteCards.push("brandIdentity");

  return { complete, missing, percent, incompleteCards };
}

function localeFromCountry(country: string | null | undefined): string {
  const c = (country ?? "").trim().toLowerCase();
  if (/malaysia|my\b/.test(c)) return "ms-MY";
  if (/singapore|sg\b/.test(c)) return "en-SG";
  if (/china|cn\b|中国/.test(c)) return "zh-CN";
  if (/taiwan|tw\b|台湾/.test(c)) return "zh-TW";
  if (/hong kong|hk\b|香港/.test(c)) return "zh-HK";
  return "en-SG";
}

export function businessProfileToBrandProfile(
  profile: Pick<
    BusinessProfileRecord,
    | "industryId"
    | "industryDisplayName"
    | "industryCustomValue"
    | "targetAudience"
    | "logo"
    | "brandPersonality"
    | "country"
    | "timezone"
  >,
  legacy?: BrandProfile
): BrandProfile {
  const personality = profile.brandPersonality?.[0]?.trim();
  return {
    industry: resolveIndustryLabel(profile) || legacy?.industry,
    targetAudience: profile.targetAudience?.trim() || legacy?.targetAudience,
    logoUrl: profile.logo?.trim() || legacy?.logoUrl,
    tone: personality || legacy?.tone,
    locale: profile.timezone?.trim()
      ? profile.timezone
      : localeFromCountry(profile.country) || legacy?.locale || "en-SG",
    bannedWords: legacy?.bannedWords ?? [],
    cta: legacy?.cta,
  };
}

export function legacyBrandProfileToBusinessProfileUpdate(legacy: BrandProfile): BusinessProfileUpdate {
  const update: BusinessProfileUpdate = {};
  if (legacy.industry?.trim()) {
    update.industryCustomValue = legacy.industry.trim();
    update.industryDisplayName = legacy.industry.trim();
    update.industryId = INDUSTRY_CUSTOM_ID;
  }
  if (legacy.targetAudience?.trim()) update.targetAudience = legacy.targetAudience.trim();
  if (legacy.logoUrl?.trim()) update.logo = legacy.logoUrl.trim();
  if (legacy.tone?.trim()) update.brandPersonality = [legacy.tone.trim()];
  return update;
}

/** Parse DB/API row with legacy industry text column if present. */
export function normalizeBusinessProfileRecord(raw: Record<string, unknown>): BusinessProfileRecord {
  const legacyIndustry = typeof raw.industry === "string" ? raw.industry : null;
  const industryId = (raw.industryId as string | null | undefined) ?? null;
  const industryDisplayName = (raw.industryDisplayName as string | null | undefined) ?? null;
  const industryCustomValue = (raw.industryCustomValue as string | null | undefined) ?? null;

  const migratedIndustry =
    !industryId && !industryDisplayName && !industryCustomValue && legacyIndustry
      ? {
          industryCustomValue: legacyIndustry,
          industryDisplayName: legacyIndustry,
          industryId: INDUSTRY_CUSTOM_ID,
        }
      : {};

  const businessHours = normalizeBusinessHours(raw.businessHours);

  return BusinessProfileRecordSchema.parse({
    ...raw,
    ...migratedIndustry,
    businessHours,
  });
}

export type { BusinessHours };
