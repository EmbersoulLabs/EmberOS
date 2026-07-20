import { z } from "zod";
import {
  getIndustryDictionaryEntry,
  getIndustryDisplayName,
  INDUSTRY_CUSTOM_ID,
} from "../dictionaries/industry-dictionary";
import { detectTimezoneFromCountryCity } from "../business-profile/timezone";
import type { Locale } from "../i18n";

/** Minimal country list for PD-012 onboarding (aligned with timezone hints). */
export const BUSINESS_COUNTRY_OPTIONS = [
  "Singapore",
  "Malaysia",
  "China",
  "Hong Kong",
  "Japan",
  "Taiwan",
  "Indonesia",
  "Thailand",
  "Australia",
  "United States",
  "United Kingdom",
] as const;

export type BusinessCountry = (typeof BUSINESS_COUNTRY_OPTIONS)[number];

const LOCALE_LANGUAGE: Record<Locale, string> = {
  en: "English",
  zh: "Chinese",
  ms: "Bahasa Melayu",
};

export function slugifyWorkspaceName(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "workspace";
}

/** PD-012 creation payload — clients send business fields only (+ orgId). */
export const CreateWorkspaceBusinessLedSchema = z.object({
  orgId: z.string().uuid(),
  businessName: z.string().trim().min(1, "Business Name is required").max(120),
  country: z.string().trim().min(1, "Country is required").max(80),
  industry: z.string().trim().min(1, "Industry is required").max(120),
  /** Optional UI locale for derived language defaults. */
  locale: z.enum(["en", "zh", "ms"]).optional(),
});

export type CreateWorkspaceBusinessLedInput = z.infer<typeof CreateWorkspaceBusinessLedSchema>;

export type ResolvedIndustrySeed = {
  industryId: string;
  industryDisplayName: string;
  industryCustomValue: string | null;
};

export function resolveIndustrySeed(
  industry: string,
  locale: Locale = "en"
): ResolvedIndustrySeed {
  const trimmed = industry.trim();
  const entry = getIndustryDictionaryEntry(trimmed);
  if (entry) {
    return {
      industryId: entry.id,
      industryDisplayName: getIndustryDisplayName(entry.id, locale),
      industryCustomValue: null,
    };
  }
  return {
    industryId: INDUSTRY_CUSTOM_ID,
    industryDisplayName: trimmed,
    industryCustomValue: trimmed,
  };
}

export function deriveWorkspaceCreateDefaults(input: {
  businessName: string;
  country: string;
  industry: string;
  locale?: Locale;
}) {
  const locale = input.locale ?? "en";
  const businessName = input.businessName.trim();
  const country = input.country.trim();
  const industry = resolveIndustrySeed(input.industry, locale);
  const baseSlug = slugifyWorkspaceName(businessName);
  const timezone =
    detectTimezoneFromCountryCity(country) ?? "Asia/Singapore";
  const supportedLanguages = [LOCALE_LANGUAGE[locale]];

  return {
    workspaceName: businessName,
    baseSlug,
    country,
    industry,
    timezone,
    supportedLanguages,
    locale,
  };
}
