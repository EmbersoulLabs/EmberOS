import type { BusinessProfileCompletionResult } from "@ceo-agent/shared";

/** Non-blocking quality warning — never use as a blocking HTTP error. */
export type BusinessProfileQualityWarning = {
  code: "BUSINESS_PROFILE_INCOMPLETE";
  message: string;
  missing: string[];
};

export function businessProfileQualityWarnings(
  completion: BusinessProfileCompletionResult
): BusinessProfileQualityWarning[] {
  if (completion.complete) return [];
  return [
    {
      code: "BUSINESS_PROFILE_INCOMPLETE",
      message: "Business Profile is incomplete. AI quality may be affected.",
      missing: [...completion.missing],
    },
  ];
}
