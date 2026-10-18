import type { BrandProfile } from "./types/index";

export interface MarketingBusinessFacts {
  companyName: string | null;
  industry: string | null;
  description: string | null;
  services: string[];
  audience: string | null;
  city: string | null;
  stateProvince: string | null;
  country: string | null;
  address: string | null;
  hours: unknown;
  phone: string | null;
  whatsapp: string | null;
  website: string | null;
  instagram: string | null;
  tiktok: string | null;
  facebook: string | null;
  youtube: string | null;
  redNote: string | null;
  linkedIn: string | null;
  tone: string | null;
  bannedWords: string[];
  approvedCta: string | null;
}

type ProfileFacts = {
  companyName?: string | null;
  industryDisplayName?: string | null;
  industryCustomValue?: string | null;
  businessDescription?: string | null;
  services?: string[] | null;
  targetAudience?: string | null;
  city?: string | null;
  stateProvince?: string | null;
  country?: string | null;
  address?: string | null;
  businessHours?: unknown;
  businessPhone?: string | null;
  whatsappBusiness?: string | null;
  website?: string | null;
  instagram?: string | null;
  tiktok?: string | null;
  facebook?: string | null;
  youtube?: string | null;
  redNote?: string | null;
  linkedIn?: string | null;
};

function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Allowlisted business facts. Missing fields stay null so prompts cannot treat them as known. */
export function selectBusinessFacts(
  profile: ProfileFacts | null | undefined,
  brand: BrandProfile | null | undefined
): MarketingBusinessFacts {
  return {
    companyName: text(profile?.companyName),
    industry: text(profile?.industryDisplayName) || text(profile?.industryCustomValue) || text(brand?.industry),
    description: text(profile?.businessDescription),
    services: (profile?.services ?? []).map((item) => item.trim()).filter(Boolean),
    audience: text(profile?.targetAudience) || text(brand?.targetAudience),
    city: text(profile?.city),
    stateProvince: text(profile?.stateProvince),
    country: text(profile?.country),
    address: text(profile?.address),
    hours: profile?.businessHours ?? null,
    phone: text(profile?.businessPhone),
    whatsapp: text(profile?.whatsappBusiness),
    website: text(profile?.website),
    instagram: text(profile?.instagram),
    tiktok: text(profile?.tiktok),
    facebook: text(profile?.facebook),
    youtube: text(profile?.youtube),
    redNote: text(profile?.redNote),
    linkedIn: text(profile?.linkedIn),
    tone: text(brand?.tone),
    bannedWords: brand?.bannedWords ?? [],
    approvedCta: text(brand?.cta),
  };
}
