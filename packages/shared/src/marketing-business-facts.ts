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
  website: string | null;
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
  website?: string | null;
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
    website: text(profile?.website),
    tone: text(brand?.tone),
    bannedWords: brand?.bannedWords ?? [],
    approvedCta: text(brand?.cta),
  };
}
