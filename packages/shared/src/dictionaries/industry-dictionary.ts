import type { Locale } from "../i18n";

/** Industry Dictionary — SPEC-001 v1.1 Patch 001. Not hardcoded in Business Profile module. */
export interface IndustryDictionaryEntry {
  id: string;
  labels: Record<Locale, string>;
}

export const INDUSTRY_DICTIONARY: IndustryDictionaryEntry[] = [
  { id: "florist", labels: { en: "Florist", zh: "花店", ms: "Kedai Bunga" } },
  { id: "wedding", labels: { en: "Wedding", zh: "婚礼", ms: "Perkahwinan" } },
  { id: "restaurant", labels: { en: "Restaurant", zh: "餐饮", ms: "Restoran" } },
  { id: "retail", labels: { en: "Retail", zh: "零售", ms: "Runcit" } },
  { id: "beauty", labels: { en: "Beauty", zh: "美容", ms: "Kecantikan" } },
  { id: "real_estate", labels: { en: "Real Estate", zh: "房地产", ms: "Hartanah" } },
  { id: "phone_buyback", labels: { en: "Phone Buyback", zh: "手机回收", ms: "Beli Balik Telefon" } },
  { id: "b2b_saas", labels: { en: "B2B SaaS", zh: "B2B SaaS", ms: "B2B SaaS" } },
  { id: "education", labels: { en: "Education", zh: "教育", ms: "Pendidikan" } },
  { id: "general", labels: { en: "General", zh: "通用", ms: "Am" } },
];

export const INDUSTRY_CUSTOM_ID = "custom";

const byId = new Map(INDUSTRY_DICTIONARY.map((e) => [e.id, e]));

export function getIndustryDictionaryEntry(id: string): IndustryDictionaryEntry | undefined {
  return byId.get(id);
}

export function getIndustryDisplayName(id: string, locale: Locale): string {
  const entry = byId.get(id);
  return entry?.labels[locale] ?? entry?.labels.en ?? id;
}

export function resolveIndustryLabel(input: {
  industryId?: string | null;
  industryDisplayName?: string | null;
  industryCustomValue?: string | null;
}): string {
  return (
    input.industryCustomValue?.trim() ||
    input.industryDisplayName?.trim() ||
    (input.industryId ? getIndustryDisplayName(input.industryId, "en") : "")
  );
}

export function hasIndustryValue(input: {
  industryId?: string | null;
  industryDisplayName?: string | null;
  industryCustomValue?: string | null;
}): boolean {
  return Boolean(resolveIndustryLabel(input));
}
