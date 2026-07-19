"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  assessBusinessProfileCompletion,
  emptyBusinessHours,
  getIndustryDisplayName,
  INDUSTRY_CUSTOM_ID,
  INDUSTRY_DICTIONARY,
  normalizeBusinessHours,
  resolveSuggestedTimezone,
  type BusinessHours,
  type BusinessProfileCardId,
  type BusinessProfileRecord,
  type BusinessProfileRequiredField,
} from "@ceo-agent/shared";
import { useI18n } from "@/lib/i18n/provider";
import type { TranslationKey } from "@ceo-agent/shared/i18n";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { TagChipInput } from "./TagChipInput";
import { BusinessHoursEditor } from "./BusinessHoursEditor";
import { ProfileCard } from "./ProfileCard";

const LANGUAGE_SUGGESTIONS = ["English", "Chinese", "Bahasa Melayu", "Japanese"];
const VOICE_SUGGESTIONS = ["Professional", "Friendly", "Luxury", "Playful", "Bold", "Warm"];
const STYLE_SUGGESTIONS = ["Modern", "Minimal", "Classic", "Vibrant", "Elegant", "Casual"];

const TIMEZONE_OPTIONS = [
  "Asia/Singapore",
  "Asia/Kuala_Lumpur",
  "Asia/Shanghai",
  "Asia/Hong_Kong",
  "Asia/Tokyo",
  "Asia/Jakarta",
  "Asia/Bangkok",
  "Australia/Sydney",
  "Europe/London",
  "America/New_York",
  "America/Los_Angeles",
  "UTC",
];

type SaveStatus = "idle" | "saving" | "saved" | "failed";

interface FormValues {
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
}

function profileToForm(profile: BusinessProfileRecord, locale: "en" | "zh" | "ms"): FormValues {
  const isCustom = profile.industryId === INDUSTRY_CUSTOM_ID || Boolean(profile.industryCustomValue);
  return {
    companyName: profile.companyName ?? "",
    industryId: isCustom ? INDUSTRY_CUSTOM_ID : profile.industryId ?? "",
    industryCustomValue: profile.industryCustomValue ?? "",
    services: profile.services ?? [],
    businessDescription: profile.businessDescription ?? "",
    targetAudience: profile.targetAudience ?? "",
    businessHours: normalizeBusinessHours(profile.businessHours),
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
    timezone:
      profile.timezone ??
      resolveSuggestedTimezone({ country: profile.country, city: profile.city }) ??
      "",
    brandPersonality: profile.brandPersonality ?? [],
    brandStyle: profile.brandStyle ?? [],
    brandValues: profile.brandValues ?? [],
    brandKeywords: profile.brandKeywords ?? [],
    logo: profile.logo ?? "",
    brandColors: profile.brandColors ?? [],
    brandFonts: profile.brandFonts ?? [],
    brandImages: profile.brandImages ?? [],
    supportedLanguages: profile.supportedLanguages ?? [],
  };
}

function formToPayload(values: FormValues, version: number, locale: "en" | "zh" | "ms") {
  const emptyToNull = (v: string) => (v.trim() ? v.trim() : null);
  const isCustom = values.industryId === INDUSTRY_CUSTOM_ID;

  return {
    version,
    companyName: values.companyName.trim(),
    industryId: isCustom ? INDUSTRY_CUSTOM_ID : values.industryId.trim() || null,
    industryDisplayName: isCustom
      ? values.industryCustomValue.trim()
      : values.industryId
        ? getIndustryDisplayName(values.industryId, locale)
        : null,
    industryCustomValue: isCustom ? values.industryCustomValue.trim() : null,
    services: values.services,
    businessDescription: values.businessDescription.trim(),
    targetAudience: values.targetAudience.trim(),
    businessHours: values.businessHours,
    businessEmail: values.businessEmail.trim(),
    businessPhone: values.businessPhone.trim(),
    whatsappBusiness: emptyToNull(values.whatsappBusiness),
    website: emptyToNull(values.website),
    facebook: emptyToNull(values.facebook),
    instagram: emptyToNull(values.instagram),
    tiktok: emptyToNull(values.tiktok),
    youtube: emptyToNull(values.youtube),
    redNote: emptyToNull(values.redNote),
    linkedIn: emptyToNull(values.linkedIn),
    country: values.country.trim(),
    stateProvince: emptyToNull(values.stateProvince),
    city: emptyToNull(values.city),
    address: values.address.trim(),
    postalCode: values.postalCode.trim(),
    timezone: values.timezone.trim(),
    brandPersonality: values.brandPersonality,
    brandStyle: values.brandStyle,
    brandValues: values.brandValues,
    brandKeywords: values.brandKeywords,
    logo: emptyToNull(values.logo),
    brandColors: values.brandColors,
    brandFonts: values.brandFonts,
    brandImages: values.brandImages,
    supportedLanguages: values.supportedLanguages,
  };
}

function completionPreview(values: FormValues) {
  const isCustom = values.industryId === INDUSTRY_CUSTOM_ID;
  return assessBusinessProfileCompletion({
    companyName: values.companyName,
    industryId: values.industryId || null,
    industryDisplayName: isCustom
      ? values.industryCustomValue
      : values.industryId
        ? getIndustryDisplayName(values.industryId, "en")
        : null,
    industryCustomValue: isCustom ? values.industryCustomValue : null,
    services: values.services,
    businessDescription: values.businessDescription,
    targetAudience: values.targetAudience,
    businessEmail: values.businessEmail,
    businessPhone: values.businessPhone,
    country: values.country,
    address: values.address,
    postalCode: values.postalCode,
    brandKeywords: values.brandKeywords,
  });
}

const FIELD_I18N: Record<BusinessProfileRequiredField, TranslationKey> = {
  companyName: "businessProfile.field.companyName",
  industry: "businessProfile.field.industry",
  services: "businessProfile.field.services",
  businessDescription: "businessProfile.field.businessDescription",
  targetAudience: "businessProfile.field.targetAudience",
  businessEmail: "businessProfile.field.businessEmail",
  businessPhone: "businessProfile.field.businessPhone",
  country: "businessProfile.field.country",
  address: "businessProfile.field.address",
  postalCode: "businessProfile.field.postalCode",
  brandKeywords: "businessProfile.field.brandKeywords",
};

function Field({
  label,
  required,
  children,
  hint,
  error,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  hint?: string;
  error?: string;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-semibold text-navy">
        {label}
        {required && (
          <span className="ml-0.5 text-red-500" aria-hidden>
            *
          </span>
        )}
      </label>
      {hint && <p className="mb-2 text-xs text-ink-secondary">{hint}</p>}
      {children}
      {error && (
        <p className="mt-1.5 text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

const inputClass =
  "w-full rounded-xl border border-border px-4 py-2.5 text-sm focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/20";

export function BusinessProfileEditor({
  workspaceId,
  slug,
  initialProfile,
}: {
  workspaceId: string;
  slug: string;
  initialProfile: BusinessProfileRecord;
}) {
  const { t, locale } = useI18n();
  const [values, setValues] = useState(() => profileToForm(initialProfile, locale));
  const [version, setVersion] = useState(initialProfile.version);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [retryToken, setRetryToken] = useState(0);
  const [analyzeNotice, setAnalyzeNotice] = useState(false);
  const skipSaveRef = useRef(true);
  const valuesRef = useRef(values);
  valuesRef.current = values;

  const completion = useMemo(() => completionPreview(values), [values]);
  const cardIncomplete = useCallback(
    (card: BusinessProfileCardId) => completion.incompleteCards.includes(card),
    [completion.incompleteCards]
  );

  const industryOptions = useMemo(
    () => [
      ...INDUSTRY_DICTIONARY.map((entry) => ({
        value: entry.id,
        label: entry.labels[locale] ?? entry.labels.en,
      })),
      { value: INDUSTRY_CUSTOM_ID, label: t("businessProfile.industry.custom") },
    ],
    [locale, t]
  );

  function patch(partial: Partial<FormValues>) {
    setValues((prev) => {
      const next = { ...prev, ...partial };
      if (!partial.timezone && (partial.country || partial.city)) {
        const suggested = resolveSuggestedTimezone({
          timezone: next.timezone,
          country: next.country,
          city: next.city,
        });
        if (suggested && !next.timezone) next.timezone = suggested;
      }
      return next;
    });
    setSaveStatus("idle");
  }

  const persist = useCallback(async () => {
    setSaveStatus("saving");
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/business-profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formToPayload(valuesRef.current, version, locale)),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 409) throw new Error(t("businessProfile.error.versionConflict"));
        throw new Error(data.error ?? t("error.generic"));
      }
      setVersion(data.profile.version);
      setSaveStatus("saved");
    } catch {
      setSaveStatus("failed");
    }
  }, [workspaceId, version, locale, t]);

  useEffect(() => {
    if (skipSaveRef.current) {
      skipSaveRef.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      void persist();
    }, 900);
    return () => window.clearTimeout(timer);
  }, [values, persist, retryToken]);

  const saveLabel =
    saveStatus === "saving"
      ? t("businessProfile.saveStatus.saving")
      : saveStatus === "saved"
        ? t("businessProfile.saveStatus.saved")
        : saveStatus === "failed"
          ? t("businessProfile.saveStatus.failed")
          : t("businessProfile.saveStatus.idle");

  return (
    <div className="space-y-6">
      <header className="rounded-xl border border-border/80 bg-surface p-4 shadow-card sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-navy sm:text-2xl">
              {t("businessProfile.title")}
            </h1>
            <p className="mt-1 text-sm text-ink-secondary">{t("businessProfile.subtitle")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-navy/10 px-3 py-1 text-xs font-semibold text-navy">
              {t("businessProfile.completionPercent", { percent: String(completion.percent) })}
            </span>
            <span
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                saveStatus === "failed"
                  ? "bg-red-50 text-red-700"
                  : saveStatus === "saved"
                    ? "bg-green-50 text-green-800"
                    : "bg-surface-muted text-ink-secondary"
              }`}
              aria-live="polite"
            >
              {saveLabel}
            </span>
            <button
              type="button"
              onClick={() => setAnalyzeNotice(true)}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-navy hover:border-brand-blue/40"
            >
              {t("businessProfile.analyzeBusiness")}
            </button>
            <LocaleSwitcher variant="light" />
          </div>
        </div>
        {!completion.complete && (
          <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {t("businessProfile.qualityNotice")}
          </p>
        )}
        {completion.complete && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-green-200 bg-green-50 px-3 py-3">
            <p className="text-sm font-medium text-green-900">{t("businessProfile.completeState")}</p>
            <Link
              href={`/w/${slug}/campaigns/new`}
              className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white hover:bg-navy/90"
            >
              {t("businessProfile.createCampaignCta")}
            </Link>
          </div>
        )}
        {saveStatus === "failed" && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
            <p className="text-sm text-red-700">{t("businessProfile.error.saveFailed")}</p>
            <button
              type="button"
              onClick={() => setRetryToken((n) => n + 1)}
              className="rounded-lg border border-red-300 px-3 py-1 text-xs font-medium text-red-800"
            >
              {t("businessProfile.retry")}
            </button>
          </div>
        )}
        {analyzeNotice && (
          <p className="mt-4 rounded-lg border border-border bg-surface-muted/50 px-3 py-2 text-sm text-ink-secondary">
            {t("businessProfile.analyzePending")}
          </p>
        )}
      </header>

      <ProfileCard title={t("businessProfile.section.business")} incomplete={cardIncomplete("overview")} saveFailed={saveStatus === "failed"}>
        <Field label={t("businessProfile.field.companyName")} required>
          <input className={inputClass} value={values.companyName} onChange={(e) => patch({ companyName: e.target.value })} required />
        </Field>
        <Field label={t("businessProfile.field.industry")} required>
          <select className={inputClass} value={values.industryId} onChange={(e) => patch({ industryId: e.target.value })} required>
            <option value="">{t("businessProfile.selectPlaceholder")}</option>
            {industryOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          {values.industryId === INDUSTRY_CUSTOM_ID && (
            <input
              className={`${inputClass} mt-2`}
              value={values.industryCustomValue}
              onChange={(e) => patch({ industryCustomValue: e.target.value })}
              placeholder={t("businessProfile.industryCustomPlaceholder")}
              required
            />
          )}
        </Field>
        <TagChipInput label={t("businessProfile.field.services")} values={values.services} onChange={(services) => patch({ services })} placeholder={t("businessProfile.tagPlaceholder")} required />
        <Field label={t("businessProfile.field.businessDescription")} required>
          <textarea className={`${inputClass} min-h-[100px]`} value={values.businessDescription} onChange={(e) => patch({ businessDescription: e.target.value })} required />
        </Field>
        <Field label={t("businessProfile.field.targetAudience")} required>
          <textarea className={`${inputClass} min-h-[80px]`} value={values.targetAudience} onChange={(e) => patch({ targetAudience: e.target.value })} required />
        </Field>
      </ProfileCard>

      <ProfileCard title={t("businessProfile.section.contact")} incomplete={cardIncomplete("contactLocation")} saveFailed={saveStatus === "failed"}>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={t("businessProfile.field.businessEmail")} required>
            <input type="email" className={inputClass} value={values.businessEmail} onChange={(e) => patch({ businessEmail: e.target.value })} required />
          </Field>
          <Field label={t("businessProfile.field.businessPhone")} required>
            <input className={inputClass} value={values.businessPhone} onChange={(e) => patch({ businessPhone: e.target.value })} required />
          </Field>
        </div>
        <Field label={t("businessProfile.field.website")} hint={t("businessProfile.urlHint")}>
          <input className={inputClass} value={values.website} onChange={(e) => patch({ website: e.target.value })} />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          {(
            [
              ["whatsappBusiness", values.whatsappBusiness],
              ["facebook", values.facebook],
              ["instagram", values.instagram],
              ["tiktok", values.tiktok],
              ["youtube", values.youtube],
              ["redNote", values.redNote],
              ["linkedIn", values.linkedIn],
            ] as const
          ).map(([key, val]) => (
            <Field key={key} label={t(`businessProfile.field.${key}` as TranslationKey)} hint={t("businessProfile.urlHint")}>
              <input className={inputClass} value={val} onChange={(e) => patch({ [key]: e.target.value })} />
            </Field>
          ))}
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={t("businessProfile.field.country")} required>
            <input className={inputClass} value={values.country} onChange={(e) => patch({ country: e.target.value })} required />
          </Field>
          <Field label={t("businessProfile.field.city")}>
            <input className={inputClass} value={values.city} onChange={(e) => patch({ city: e.target.value })} />
          </Field>
          <Field label={t("businessProfile.field.stateProvince")}>
            <input className={inputClass} value={values.stateProvince} onChange={(e) => patch({ stateProvince: e.target.value })} />
          </Field>
          <Field label={t("businessProfile.field.postalCode")} required>
            <input className={inputClass} value={values.postalCode} onChange={(e) => patch({ postalCode: e.target.value })} required />
          </Field>
        </div>
        <Field label={t("businessProfile.field.address")} required>
          <textarea className={`${inputClass} min-h-[72px]`} value={values.address} onChange={(e) => patch({ address: e.target.value })} required />
        </Field>
        <Field label={t("businessProfile.field.timezone")} hint={t("businessProfile.timezoneHint")}>
          <select className={inputClass} value={values.timezone} onChange={(e) => patch({ timezone: e.target.value })}>
            <option value="">{t("businessProfile.selectPlaceholder")}</option>
            {TIMEZONE_OPTIONS.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
            {values.timezone && !TIMEZONE_OPTIONS.includes(values.timezone) && (
              <option value={values.timezone}>{values.timezone}</option>
            )}
          </select>
        </Field>
      </ProfileCard>

      <ProfileCard title={t("businessProfile.section.brand")} incomplete={cardIncomplete("brandIdentity")} saveFailed={saveStatus === "failed"}>
        <Field label={t("businessProfile.field.logo")} hint={t("businessProfile.uploadReferenceHint")}>
          <input className={inputClass} value={values.logo} onChange={(e) => patch({ logo: e.target.value })} placeholder={t("businessProfile.storagePathPlaceholder")} />
        </Field>
        <TagChipInput label={t("businessProfile.field.brandColors")} values={values.brandColors} onChange={(brandColors) => patch({ brandColors })} placeholder="#FF5733" />
        <TagChipInput label={t("businessProfile.field.brandStyle")} values={values.brandStyle} onChange={(brandStyle) => patch({ brandStyle })} suggestions={STYLE_SUGGESTIONS} />
        <TagChipInput label={t("businessProfile.field.brandVoice")} values={values.brandPersonality} onChange={(brandPersonality) => patch({ brandPersonality })} suggestions={VOICE_SUGGESTIONS} />
        <TagChipInput label={t("businessProfile.field.brandValues")} values={values.brandValues} onChange={(brandValues) => patch({ brandValues })} />
        <TagChipInput label={t("businessProfile.field.brandKeywords")} values={values.brandKeywords} onChange={(brandKeywords) => patch({ brandKeywords })} placeholder={t("businessProfile.tagPlaceholder")} required />
      </ProfileCard>

      <ProfileCard title={t("businessProfile.section.assets")} saveFailed={saveStatus === "failed"}>
        <p className="text-xs text-ink-secondary">{t("businessProfile.assetsHint")}</p>
        <div className="rounded-xl border border-dashed border-border bg-surface-muted/40 px-4 py-8 text-center">
          <p className="text-sm font-medium text-navy">{t("businessProfile.uploadArea.title")}</p>
          <p className="mt-1 text-xs text-ink-secondary">{t("businessProfile.uploadArea.pendingSpec")}</p>
        </div>
        <TagChipInput label={t("businessProfile.field.brandFonts")} values={values.brandFonts} onChange={(brandFonts) => patch({ brandFonts })} />
        <TagChipInput label={t("businessProfile.field.brandImages")} values={values.brandImages} onChange={(brandImages) => patch({ brandImages })} placeholder={t("businessProfile.storagePathPlaceholder")} />
      </ProfileCard>

      <ProfileCard title={t("businessProfile.section.languages")} saveFailed={saveStatus === "failed"}>
        <p className="text-xs text-ink-secondary">{t("businessProfile.languagesHint")}</p>
        <TagChipInput label={t("businessProfile.field.supportedLanguages")} values={values.supportedLanguages} onChange={(supportedLanguages) => patch({ supportedLanguages })} suggestions={LANGUAGE_SUGGESTIONS} />
      </ProfileCard>

      <ProfileCard title={t("businessProfile.section.businessHours")} saveFailed={saveStatus === "failed"}>
        <p className="text-xs text-ink-secondary">{t("businessProfile.optionalHint")}</p>
        <BusinessHoursEditor
          value={values.businessHours.length ? values.businessHours : emptyBusinessHours()}
          onChange={(businessHours) => patch({ businessHours })}
        />
      </ProfileCard>

      {!completion.complete && completion.missing.length > 0 && (
        <p className="text-xs text-ink-secondary">
          {t("businessProfile.missingFields")}:{" "}
          {completion.missing.map((field) => t(FIELD_I18N[field])).join(", ")}
        </p>
      )}
    </div>
  );
}
