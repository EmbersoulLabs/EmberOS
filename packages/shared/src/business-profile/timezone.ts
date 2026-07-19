/** SPEC-001 v1.1 timezone detection priority: Browser -> Country+City -> Manual */

const COUNTRY_CITY_TIMEZONE: Record<string, Record<string, string>> = {
  singapore: { default: "Asia/Singapore" },
  malaysia: { default: "Asia/Kuala_Lumpur", "kuala lumpur": "Asia/Kuala_Lumpur", penang: "Asia/Kuala_Lumpur" },
  china: { default: "Asia/Shanghai", shanghai: "Asia/Shanghai", beijing: "Asia/Shanghai" },
  "hong kong": { default: "Asia/Hong_Kong" },
  japan: { default: "Asia/Tokyo", tokyo: "Asia/Tokyo" },
};

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

export function detectTimezoneFromCountryCity(country?: string | null, city?: string | null): string | null {
  const countryKey = normalizeKey(country ?? "");
  if (!countryKey) return null;

  const map = COUNTRY_CITY_TIMEZONE[countryKey];
  if (!map) return null;

  const cityKey = normalizeKey(city ?? "");
  if (cityKey && map[cityKey]) return map[cityKey]!;
  return map.default ?? null;
}

export function detectBrowserTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/** Apply SPEC-001 detection priority when timezone is not yet confirmed. */
export function resolveSuggestedTimezone(input: {
  timezone?: string | null;
  country?: string | null;
  city?: string | null;
}): string | null {
  if (input.timezone?.trim()) return input.timezone.trim();
  return detectBrowserTimezone() ?? detectTimezoneFromCountryCity(input.country, input.city);
}
