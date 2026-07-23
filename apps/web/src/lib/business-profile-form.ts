import {
  BusinessProfileUpdateSchema,
  emptyBusinessHours,
  getIndustryDisplayName,
  INDUSTRY_CUSTOM_ID,
  type BusinessHours,
  type BusinessProfileRecord,
  type BusinessProfileUpdate,
  type Locale,
} from "@ceo-agent/shared";

export type BusinessProfileFormValues = {
  companyName: string;
  industryId: string;
  industryCustomValue: string;
  services: string[];
  businessDescription: string;
  targetAudience: string;
  businessHours: BusinessHours;
  businessEmail: string;
  businessPhone: string;
  whatsappBusiness: string;
  website: string;
  facebook: string;
  instagram: string;
  tiktok: string;
  youtube: string;
  redNote: string;
  linkedIn: string;
  country: string;
  stateProvince: string;
  city: string;
  address: string;
  postalCode: string;
  timezone: string;
  brandPersonality: string[];
  brandStyle: string[];
  brandValues: string[];
  brandKeywords: string[];
  logo: string;
  brandColors: string[];
  brandFonts: string[];
  brandImages: string[];
  supportedLanguages: string[];
  defaultPublishingPlatforms: string[];
};

export type BusinessProfileApiWarning = {
  code: string;
  message: string;
  missing?: string[];
};

export type BusinessProfileLoadStatus =
  | "loading"
  | "ready"
  | "empty"
  | "forbidden"
  | "not_found"
  | "error";

export function createEmptyBusinessProfileDraft(
  orgId: string,
  workspaceId: string
): BusinessProfileRecord {
  const now = new Date();
  return {
    id: "00000000-0000-4000-8000-000000000001",
    orgId,
    workspaceId,
    companyName: null,
    industryId: null,
    industryDisplayName: null,
    industryCustomValue: null,
    services: [],
    businessDescription: null,
    targetAudience: null,
    businessHours: emptyBusinessHours(),
    businessEmail: null,
    businessPhone: null,
    whatsappBusiness: null,
    website: null,
    facebook: null,
    instagram: null,
    tiktok: null,
    youtube: null,
    redNote: null,
    linkedIn: null,
    country: null,
    stateProvince: null,
    city: null,
    address: null,
    postalCode: null,
    timezone: null,
    brandPersonality: [],
    brandStyle: [],
    brandValues: [],
    brandKeywords: [],
    logo: null,
    brandColors: [],
    brandFonts: [],
    brandImages: [],
    supportedLanguages: [],
    defaultPublishingPlatforms: [],
    createdAt: now,
    updatedAt: now,
    createdBy: null,
    updatedBy: null,
    deletedAt: null,
    version: 1,
  };
}

export function profileToFormValues(
  profile: BusinessProfileRecord
): BusinessProfileFormValues {
  const isCustom =
    profile.industryId === INDUSTRY_CUSTOM_ID || Boolean(profile.industryCustomValue);
  return {
    companyName: profile.companyName ?? "",
    industryId: isCustom ? INDUSTRY_CUSTOM_ID : (profile.industryId ?? ""),
    industryCustomValue: profile.industryCustomValue ?? "",
    services: profile.services ?? [],
    businessDescription: profile.businessDescription ?? "",
    targetAudience: profile.targetAudience ?? "",
    businessHours: profile.businessHours?.length
      ? profile.businessHours
      : emptyBusinessHours(),
    businessEmail: profile.businessEmail ?? "",
    businessPhone: profile.businessPhone ?? "",
    whatsappBusiness: profile.whatsappBusiness ?? "",
    website: profile.website ?? "",
    facebook: profile.facebook ?? "",
    instagram: profile.instagram ?? "",
    tiktok: profile.tiktok ?? "",
    youtube: profile.youtube ?? "",
    redNote: profile.redNote ?? "",
    linkedIn: profile.linkedIn ?? "",
    country: profile.country ?? "",
    stateProvince: profile.stateProvince ?? "",
    city: profile.city ?? "",
    address: profile.address ?? "",
    postalCode: profile.postalCode ?? "",
    timezone: profile.timezone ?? "",
    brandPersonality: profile.brandPersonality ?? [],
    brandStyle: profile.brandStyle ?? [],
    brandValues: profile.brandValues ?? [],
    brandKeywords: profile.brandKeywords ?? [],
    logo: profile.logo ?? "",
    brandColors: profile.brandColors ?? [],
    brandFonts: profile.brandFonts ?? [],
    brandImages: profile.brandImages ?? [],
    supportedLanguages: profile.supportedLanguages ?? [],
    defaultPublishingPlatforms: profile.defaultPublishingPlatforms ?? [],
  };
}

/** Normalize text for dirty comparison. */
function normText(value: string): string {
  return value.trim();
}

function normList(values: string[]): string[] {
  return values.map((v) => v.trim()).filter(Boolean);
}

function listsEqual(a: string[], b: string[]): boolean {
  const left = normList(a);
  const right = normList(b);
  if (left.length !== right.length) return false;
  return left.every((v, i) => v === right[i]);
}

function hoursEqual(a: BusinessHours, b: BusinessHours): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Sparse PATCH: only include fields that changed vs baseline.
 * Cleared nullable / clearable fields are sent as null or [] so the server
 * does not preserve stale values. Fields the schema forbids empty (min(1))
 * are omitted when blank.
 */
export function buildBusinessProfilePatch(
  values: BusinessProfileFormValues,
  version: number,
  locale: Locale,
  baseline?: BusinessProfileFormValues
): BusinessProfileUpdate {
  const base = baseline ?? values;
  const patch: BusinessProfileUpdate = { version };
  const out = patch as Record<string, unknown>;

  const setChangedText = (
    key: keyof BusinessProfileUpdate,
    current: string,
    previous: string,
    opts: { clearAsNull?: boolean; allowEmpty?: boolean } = {}
  ) => {
    const cur = normText(current);
    const prev = normText(previous);
    if (cur === prev) return;
    if (cur) {
      out[key] = cur;
      return;
    }
    if (opts.clearAsNull) out[key] = null;
    else if (opts.allowEmpty) out[key] = "";
  };

  const setChangedList = (
    key: keyof BusinessProfileUpdate,
    current: string[],
    previous: string[],
    opts: { allowEmptyClear?: boolean } = {}
  ) => {
    if (listsEqual(current, previous)) return;
    const next = normList(current);
    if (next.length > 0) {
      out[key] = next;
      return;
    }
    if (opts.allowEmptyClear) out[key] = [];
  };

  // min(1) text — send only when non-empty and changed (schema cannot clear)
  setChangedText("companyName", values.companyName, base.companyName);
  setChangedText("businessDescription", values.businessDescription, base.businessDescription);
  setChangedText("targetAudience", values.targetAudience, base.targetAudience);
  setChangedText("businessEmail", values.businessEmail, base.businessEmail);
  setChangedText("businessPhone", values.businessPhone, base.businessPhone);
  setChangedText("country", values.country, base.country);
  setChangedText("address", values.address, base.address);
  setChangedText("postalCode", values.postalCode, base.postalCode);
  setChangedText("timezone", values.timezone, base.timezone);

  // Optional nullable text — clear as null
  setChangedText("stateProvince", values.stateProvince, base.stateProvince, {
    clearAsNull: true,
  });
  setChangedText("city", values.city, base.city, { clearAsNull: true });
  setChangedText("logo", values.logo, base.logo, { clearAsNull: true });

  // Social / URL nullable — clear as null
  setChangedText("whatsappBusiness", values.whatsappBusiness, base.whatsappBusiness, {
    clearAsNull: true,
  });
  setChangedText("website", values.website, base.website, { clearAsNull: true });
  setChangedText("facebook", values.facebook, base.facebook, { clearAsNull: true });
  setChangedText("instagram", values.instagram, base.instagram, { clearAsNull: true });
  setChangedText("tiktok", values.tiktok, base.tiktok, { clearAsNull: true });
  setChangedText("youtube", values.youtube, base.youtube, { clearAsNull: true });
  setChangedText("redNote", values.redNote, base.redNote, { clearAsNull: true });
  setChangedText("linkedIn", values.linkedIn, base.linkedIn, { clearAsNull: true });

  // Arrays: services / brandKeywords require min(1) — omit when emptied
  setChangedList("services", values.services, base.services);
  setChangedList("brandKeywords", values.brandKeywords, base.brandKeywords);
  // Optional arrays — empty [] clears
  setChangedList("brandPersonality", values.brandPersonality, base.brandPersonality, {
    allowEmptyClear: true,
  });
  setChangedList("brandStyle", values.brandStyle, base.brandStyle, {
    allowEmptyClear: true,
  });
  setChangedList("brandValues", values.brandValues, base.brandValues, {
    allowEmptyClear: true,
  });
  setChangedList("brandColors", values.brandColors, base.brandColors, {
    allowEmptyClear: true,
  });
  setChangedList("brandFonts", values.brandFonts, base.brandFonts, {
    allowEmptyClear: true,
  });
  setChangedList("brandImages", values.brandImages, base.brandImages, {
    allowEmptyClear: true,
  });
  setChangedList("supportedLanguages", values.supportedLanguages, base.supportedLanguages, {
    allowEmptyClear: true,
  });
  setChangedList(
    "defaultPublishingPlatforms",
    values.defaultPublishingPlatforms,
    base.defaultPublishingPlatforms,
    { allowEmptyClear: true }
  );

  const curCustom = values.industryId === INDUSTRY_CUSTOM_ID;
  const prevCustom = base.industryId === INDUSTRY_CUSTOM_ID;
  const curIndustryId = curCustom
    ? INDUSTRY_CUSTOM_ID
    : normText(values.industryId) || null;
  const prevIndustryId = prevCustom
    ? INDUSTRY_CUSTOM_ID
    : normText(base.industryId) || null;
  const curCustomValue = curCustom ? normText(values.industryCustomValue) : "";
  const prevCustomValue = prevCustom ? normText(base.industryCustomValue) : "";

  if (curIndustryId !== prevIndustryId || curCustomValue !== prevCustomValue) {
    if (curCustom && curCustomValue) {
      patch.industryId = INDUSTRY_CUSTOM_ID;
      patch.industryCustomValue = curCustomValue;
      patch.industryDisplayName = curCustomValue;
    } else if (curIndustryId && !curCustom) {
      patch.industryId = curIndustryId;
      patch.industryDisplayName = getIndustryDisplayName(curIndustryId, locale);
      patch.industryCustomValue = null;
    } else {
      patch.industryId = null;
      patch.industryDisplayName = null;
      patch.industryCustomValue = null;
    }
  }

  if (!hoursEqual(values.businessHours, base.businessHours)) {
    patch.businessHours = values.businessHours;
  }

  return patch;
}

export function validateBusinessProfilePatch(patch: BusinessProfileUpdate) {
  return BusinessProfileUpdateSchema.safeParse(patch);
}

export function isVersionConflictStatus(status: number): boolean {
  return status === 409;
}

export function classifyBusinessProfileHttpStatus(
  status: number
): Exclude<BusinessProfileLoadStatus, "loading" | "ready" | "empty"> | "ok" {
  if (status === 200 || status === 201) return "ok";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  return "error";
}

export function extractApiWarnings(data: unknown): BusinessProfileApiWarning[] {
  if (!data || typeof data !== "object") return [];
  const warnings = (data as { warnings?: unknown }).warnings;
  if (!Array.isArray(warnings)) return [];
  return warnings.filter(
    (w): w is BusinessProfileApiWarning =>
      Boolean(w) &&
      typeof w === "object" &&
      typeof (w as BusinessProfileApiWarning).code === "string" &&
      typeof (w as BusinessProfileApiWarning).message === "string"
  );
}
