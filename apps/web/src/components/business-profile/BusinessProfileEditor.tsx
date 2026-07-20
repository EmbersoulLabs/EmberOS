"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  assessBusinessProfileCompletion,
  emptyBusinessHours,
  INDUSTRY_CUSTOM_ID,
  INDUSTRY_DICTIONARY,
  normalizeBusinessProfileRecord,
  resolveSuggestedTimezone,
  businessProfileAiAnalysisToUpdate,
  validateBusinessProfileAiAnalysis,
  type BusinessProfileAiAnalysis,
  type BusinessProfileCardId,
  type BusinessProfileRecord,
  type BusinessProfileRequiredField,
} from "@ceo-agent/shared";
import { useI18n } from "@/lib/i18n/provider";
import type { TranslationKey } from "@ceo-agent/shared/i18n";
import { TagChipInput } from "./TagChipInput";
import { BusinessHoursEditor } from "./BusinessHoursEditor";
import { ProfileCard } from "./ProfileCard";
import { BusinessProfileAiPanel } from "./BusinessProfileAiPanel";
import {
  buildBusinessProfilePatch,
  extractApiWarnings,
  profileToFormValues,
  validateBusinessProfilePatch,
  type BusinessProfileApiWarning,
  type BusinessProfileFormValues,
} from "@/lib/business-profile-form";

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

type SaveStatus = "idle" | "saving" | "saved" | "failed" | "conflict" | "invalid";

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

function completionPreview(values: BusinessProfileFormValues) {
  const isCustom = values.industryId === INDUSTRY_CUSTOM_ID;
  return assessBusinessProfileCompletion({
    companyName: values.companyName,
    industryId: values.industryId || null,
    industryDisplayName: isCustom ? values.industryCustomValue : null,
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

export function BusinessProfileEditor({
  workspaceId,
  slug,
  initialProfile,
  initialWarnings = [],
  onSynced,
  onRequestRefresh,
}: {
  workspaceId: string;
  slug: string;
  initialProfile: BusinessProfileRecord;
  initialWarnings?: BusinessProfileApiWarning[];
  onSynced?: (profile: BusinessProfileRecord, warnings: BusinessProfileApiWarning[]) => void;
  onRequestRefresh?: () => void;
}) {
  const { t, locale } = useI18n();
  const [values, setValues] = useState(() => profileToFormValues(initialProfile));
  const [version, setVersion] = useState(initialProfile.version);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [apiWarnings, setApiWarnings] = useState(initialWarnings);
  const [retryToken, setRetryToken] = useState(0);
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [aiDraft, setAiDraft] = useState<BusinessProfileAiAnalysis | null>(null);
  const [aiConfidence, setAiConfidence] = useState<number | null>(null);
  const [aiSourcesUsed, setAiSourcesUsed] = useState<string[]>([]);
  const [aiMissingSources, setAiMissingSources] = useState<string[]>([]);
  const [aiError, setAiError] = useState<string | null>(null);
  const skipSaveRef = useRef(true);
  const conflictRef = useRef(false);
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const versionRef = useRef(version);
  versionRef.current = version;
  const baselineRef = useRef(profileToFormValues(initialProfile));

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

  function patch(partial: Partial<BusinessProfileFormValues>) {
    if (conflictRef.current) return;
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
    setFieldErrors({});
    setSaveStatus("idle");
  }

  const persist = useCallback(async () => {
    const payload = buildBusinessProfilePatch(
      valuesRef.current,
      versionRef.current,
      locale,
      baselineRef.current
    );
    const parsed = validateBusinessProfilePatch(payload);
    if (!parsed.success) {
      const nextErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "form");
        nextErrors[key] = issue.message || t("businessProfile.fieldError.invalid");
      }
      setFieldErrors(nextErrors);
      setSaveStatus("invalid");
      return;
    }

    // Nothing dirty besides version — skip no-op network write
    const dirtyKeys = Object.keys(parsed.data).filter((k) => k !== "version");
    if (dirtyKeys.length === 0) {
      setSaveStatus("saved");
      return;
    }

    setSaveStatus("saving");
    setFieldErrors({});
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/business-profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const data = await res.json();
      if (res.status === 409) {
        conflictRef.current = true;
        setSaveStatus("conflict");
        return;
      }
      if (!res.ok) {
        if (res.status === 400) {
          setFieldErrors({ form: data.error ?? t("businessProfile.fieldError.invalid") });
          setSaveStatus("invalid");
          return;
        }
        throw new Error(data.error ?? t("error.generic"));
      }
      const nextProfile = normalizeBusinessProfileRecord(data.profile);
      const nextWarnings = extractApiWarnings(data);
      baselineRef.current = profileToFormValues(nextProfile);
      setVersion(nextProfile.version);
      versionRef.current = nextProfile.version;
      setApiWarnings(nextWarnings);
      setSaveStatus("saved");
      onSynced?.(nextProfile, nextWarnings);
    } catch {
      setSaveStatus("failed");
    }
  }, [workspaceId, locale, t, onSynced]);

  const runAiAnalyze = useCallback(async () => {
    if (aiAnalyzing) return;
    setAiAnalyzing(true);
    setAiError(null);
    try {
      const current = valuesRef.current;
      const isCustom = current.industryId === INDUSTRY_CUSTOM_ID;
      const industryEntry = INDUSTRY_DICTIONARY.find((e) => e.id === current.industryId);
      const res = await fetch(`/api/workspaces/${workspaceId}/business-profile/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: current.companyName || null,
          industryId: current.industryId || null,
          industryDisplayName: isCustom
            ? null
            : (industryEntry?.labels.en ?? current.industryId) || null,
          industryCustomValue: isCustom ? current.industryCustomValue || null : null,
          services: current.services,
          businessDescription: current.businessDescription || null,
          targetAudience: current.targetAudience || null,
          website: current.website || null,
          facebook: current.facebook || null,
          instagram: current.instagram || null,
          tiktok: current.tiktok || null,
          youtube: current.youtube || null,
          redNote: current.redNote || null,
          linkedIn: current.linkedIn || null,
          logo: current.logo || null,
          brandColors: current.brandColors,
          brandKeywords: current.brandKeywords,
          brandPersonality: current.brandPersonality,
          country: current.country || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAiError(data.error ?? t("businessProfile.ai.error"));
        // Keep prior draft if re-analyze fails so saved profile is untouched.
        if (!aiDraft) setAiDraft(null);
        return;
      }

      const checked = validateBusinessProfileAiAnalysis({
        brandSummary: data.brandSummary,
        brandPersonality: data.brandPersonality,
        brandTone: data.brandTone,
        brandKeywords: data.brandKeywords,
        targetAudience: data.targetAudience,
      });
      if (!checked.ok) {
        setAiError(t("businessProfile.ai.error"));
        return;
      }

      setAiDraft(checked.analysis);
      setAiConfidence(typeof data.confidence === "number" ? data.confidence : null);
      setAiSourcesUsed(Array.isArray(data.sourcesUsed) ? data.sourcesUsed : []);
      setAiMissingSources(Array.isArray(data.missingSources) ? data.missingSources : []);
    } catch {
      setAiError(t("businessProfile.ai.error"));
    } finally {
      setAiAnalyzing(false);
    }
  }, [aiAnalyzing, aiDraft, t, workspaceId]);

  const acceptAiAnalysis = useCallback(() => {
    if (!aiDraft) return;
    const checked = validateBusinessProfileAiAnalysis(aiDraft);
    if (!checked.ok) {
      setAiError(checked.message || t("businessProfile.ai.error"));
      return;
    }
    const update = businessProfileAiAnalysisToUpdate(checked.analysis);
    if (conflictRef.current) return;

    // Apply into form + refs synchronously so persist sees accepted values.
    // Never wrote to the API until this explicit Accept & Save.
    const nextValues: BusinessProfileFormValues = {
      ...valuesRef.current,
      businessDescription: update.businessDescription,
      brandPersonality: update.brandPersonality,
      brandKeywords: update.brandKeywords,
      targetAudience: update.targetAudience,
    };
    valuesRef.current = nextValues;
    setValues(nextValues);
    setFieldErrors({});
    setSaveStatus("idle");
    setAiDraft(null);
    setAiError(null);
    setAiConfidence(null);
    setAiSourcesUsed([]);
    setAiMissingSources([]);
    window.setTimeout(() => {
      void persist();
    }, 0);
  }, [aiDraft, persist, t]);

  useEffect(() => {
    if (skipSaveRef.current) {
      skipSaveRef.current = false;
      return;
    }
    if (conflictRef.current) return;
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
        : saveStatus === "failed" || saveStatus === "invalid" || saveStatus === "conflict"
          ? t("businessProfile.saveStatus.failed")
          : t("businessProfile.saveStatus.idle");

  const qualityWarnings =
    apiWarnings.length > 0
      ? apiWarnings
      : !completion.complete
        ? [
            {
              code: "BUSINESS_PROFILE_INCOMPLETE",
              message: t("businessProfile.qualityNotice"),
              missing: [...completion.missing],
            },
          ]
        : [];

  return (
    <div className="space-y-6">
      <header className="rounded-xl border border-border/80 bg-surface p-4 shadow-card sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3 sm:gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold tracking-tight text-navy sm:text-2xl">
              {t("businessProfile.title")}
            </h1>
            <p className="mt-1 text-sm text-ink-secondary">{t("businessProfile.subtitle")}</p>
          </div>
          <div className="flex w-full flex-wrap items-center justify-start gap-2 sm:w-auto sm:justify-end">
            <span className="rounded-full bg-navy/10 px-3 py-1 text-xs font-semibold text-navy">
              {t("businessProfile.completionPercent", { percent: String(completion.percent) })}
            </span>
            <span
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                saveStatus === "failed" || saveStatus === "invalid" || saveStatus === "conflict"
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
              onClick={() => void persist()}
              disabled={saveStatus === "saving" || saveStatus === "conflict"}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-navy hover:border-brand-blue/40 disabled:opacity-50"
            >
              {t("businessProfile.saveNow")}
            </button>
            <button
              type="button"
              onClick={() => void runAiAnalyze()}
              disabled={aiAnalyzing}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-navy hover:border-brand-blue/40 disabled:opacity-50"
            >
              {aiAnalyzing
                ? t("businessProfile.ai.loading")
                : t("businessProfile.ai.analyze")}
            </button>
          </div>
        </div>
        {(aiDraft || aiAnalyzing || aiError) && (
          <BusinessProfileAiPanel
            draft={
              aiDraft ?? {
                brandSummary: "",
                brandPersonality: [],
                brandTone: [],
                brandKeywords: [],
                targetAudience: [],
              }
            }
            confidence={aiConfidence}
            sourcesUsed={aiSourcesUsed}
            missingSources={aiMissingSources}
            analyzing={aiAnalyzing}
            error={aiError}
            onChange={(next) => setAiDraft(next)}
            onReanalyze={() => void runAiAnalyze()}
            onAcceptSave={acceptAiAnalysis}
            onDismiss={() => {
              setAiDraft(null);
              setAiError(null);
              setAiConfidence(null);
              setAiSourcesUsed([]);
              setAiMissingSources([]);
            }}
          />
        )}

        {qualityWarnings.length > 0 && (
          <div
            className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
            role="status"
          >
            <p className="font-medium">{t("businessProfile.warnings.title")}</p>
            {qualityWarnings.map((w) => (
              <p key={w.code} className="mt-1">
                {w.message}
              </p>
            ))}
          </div>
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

        {saveStatus === "conflict" && (
          <div
            className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2"
            role="alert"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-amber-950">
                {t("businessProfile.error.versionConflict")}
              </p>
              <p className="mt-1 text-xs text-amber-900">
                {t("businessProfile.error.versionConflictDetail")}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onRequestRefresh?.()}
              className="rounded-lg border border-amber-400 px-3 py-1 text-xs font-medium text-amber-950"
            >
              {t("businessProfile.refresh")}
            </button>
          </div>
        )}

        {(saveStatus === "failed" || saveStatus === "invalid") && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
            <p className="text-sm text-red-700">
              {fieldErrors.form ?? t("businessProfile.error.saveFailed")}
            </p>
            <button
              type="button"
              onClick={() => setRetryToken((n) => n + 1)}
              className="rounded-lg border border-red-300 px-3 py-1 text-xs font-medium text-red-800"
            >
              {t("businessProfile.retry")}
            </button>
          </div>
        )}
      </header>

      <ProfileCard
        title={t("businessProfile.section.business")}
        incomplete={cardIncomplete("overview")}
        saveFailed={saveStatus === "failed" || saveStatus === "invalid"}
      >
        <Field
          label={t("businessProfile.field.companyName")}
          required
          error={fieldErrors.companyName}
        >
          <input
            className={inputClass}
            value={values.companyName}
            onChange={(e) => patch({ companyName: e.target.value })}
          />
        </Field>
        <Field label={t("businessProfile.field.industry")} required error={fieldErrors.industryId}>
          <select
            className={inputClass}
            value={values.industryId}
            onChange={(e) => patch({ industryId: e.target.value })}
          >
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
            />
          )}
        </Field>
        <TagChipInput
          label={t("businessProfile.field.services")}
          values={values.services}
          onChange={(services) => patch({ services })}
          placeholder={t("businessProfile.tagPlaceholder")}
          required
        />
        <Field
          label={t("businessProfile.field.businessDescription")}
          required
          error={fieldErrors.businessDescription}
        >
          <textarea
            className={`${inputClass} min-h-[100px]`}
            value={values.businessDescription}
            onChange={(e) => patch({ businessDescription: e.target.value })}
          />
        </Field>
        <Field
          label={t("businessProfile.field.targetAudience")}
          required
          error={fieldErrors.targetAudience}
        >
          <textarea
            className={`${inputClass} min-h-[80px]`}
            value={values.targetAudience}
            onChange={(e) => patch({ targetAudience: e.target.value })}
          />
        </Field>
      </ProfileCard>

      <ProfileCard
        title={t("businessProfile.section.contact")}
        incomplete={cardIncomplete("contactLocation")}
        saveFailed={saveStatus === "failed" || saveStatus === "invalid"}
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label={t("businessProfile.field.businessEmail")}
            required
            error={fieldErrors.businessEmail}
          >
            <input
              type="email"
              className={inputClass}
              value={values.businessEmail}
              onChange={(e) => patch({ businessEmail: e.target.value })}
            />
          </Field>
          <Field
            label={t("businessProfile.field.businessPhone")}
            required
            error={fieldErrors.businessPhone}
          >
            <input
              className={inputClass}
              value={values.businessPhone}
              onChange={(e) => patch({ businessPhone: e.target.value })}
            />
          </Field>
        </div>
        <Field label={t("businessProfile.field.website")} hint={t("businessProfile.urlHint")} error={fieldErrors.website}>
          <input
            className={inputClass}
            value={values.website}
            onChange={(e) => patch({ website: e.target.value })}
          />
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
            <Field
              key={key}
              label={t(`businessProfile.field.${key}` as TranslationKey)}
              hint={t("businessProfile.urlHint")}
              error={fieldErrors[key]}
            >
              <input
                className={inputClass}
                value={val}
                onChange={(e) => patch({ [key]: e.target.value })}
              />
            </Field>
          ))}
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={t("businessProfile.field.country")} required error={fieldErrors.country}>
            <input
              className={inputClass}
              value={values.country}
              onChange={(e) => patch({ country: e.target.value })}
            />
          </Field>
          <Field label={t("businessProfile.field.city")}>
            <input
              className={inputClass}
              value={values.city}
              onChange={(e) => patch({ city: e.target.value })}
            />
          </Field>
          <Field label={t("businessProfile.field.stateProvince")}>
            <input
              className={inputClass}
              value={values.stateProvince}
              onChange={(e) => patch({ stateProvince: e.target.value })}
            />
          </Field>
          <Field
            label={t("businessProfile.field.postalCode")}
            required
            error={fieldErrors.postalCode}
          >
            <input
              className={inputClass}
              value={values.postalCode}
              onChange={(e) => patch({ postalCode: e.target.value })}
            />
          </Field>
        </div>
        <Field label={t("businessProfile.field.address")} required error={fieldErrors.address}>
          <textarea
            className={`${inputClass} min-h-[72px]`}
            value={values.address}
            onChange={(e) => patch({ address: e.target.value })}
          />
        </Field>
        <Field label={t("businessProfile.field.timezone")} hint={t("businessProfile.timezoneHint")}>
          <select
            className={inputClass}
            value={values.timezone}
            onChange={(e) => patch({ timezone: e.target.value })}
          >
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

      <ProfileCard
        title={t("businessProfile.section.brand")}
        incomplete={cardIncomplete("brandIdentity")}
        saveFailed={saveStatus === "failed" || saveStatus === "invalid"}
      >
        <Field label={t("businessProfile.field.logo")} hint={t("businessProfile.uploadReferenceHint")}>
          <input
            className={inputClass}
            value={values.logo}
            onChange={(e) => patch({ logo: e.target.value })}
            placeholder={t("businessProfile.storagePathPlaceholder")}
          />
        </Field>
        <TagChipInput
          label={t("businessProfile.field.brandColors")}
          values={values.brandColors}
          onChange={(brandColors) => patch({ brandColors })}
          placeholder="#FF5733"
        />
        <TagChipInput
          label={t("businessProfile.field.brandStyle")}
          values={values.brandStyle}
          onChange={(brandStyle) => patch({ brandStyle })}
          suggestions={STYLE_SUGGESTIONS}
        />
        <TagChipInput
          label={t("businessProfile.field.brandVoice")}
          values={values.brandPersonality}
          onChange={(brandPersonality) => patch({ brandPersonality })}
          suggestions={VOICE_SUGGESTIONS}
        />
        <TagChipInput
          label={t("businessProfile.field.brandValues")}
          values={values.brandValues}
          onChange={(brandValues) => patch({ brandValues })}
        />
        <TagChipInput
          label={t("businessProfile.field.brandKeywords")}
          values={values.brandKeywords}
          onChange={(brandKeywords) => patch({ brandKeywords })}
          placeholder={t("businessProfile.tagPlaceholder")}
          required
        />
      </ProfileCard>

      <ProfileCard
        title={t("businessProfile.section.assets")}
        saveFailed={saveStatus === "failed" || saveStatus === "invalid"}
      >
        <p className="text-xs text-ink-secondary">{t("businessProfile.assetsHint")}</p>
        <TagChipInput
          label={t("businessProfile.field.brandFonts")}
          values={values.brandFonts}
          onChange={(brandFonts) => patch({ brandFonts })}
        />
        <TagChipInput
          label={t("businessProfile.field.brandImages")}
          values={values.brandImages}
          onChange={(brandImages) => patch({ brandImages })}
          placeholder={t("businessProfile.storagePathPlaceholder")}
        />
      </ProfileCard>

      <ProfileCard
        title={t("businessProfile.section.languages")}
        saveFailed={saveStatus === "failed" || saveStatus === "invalid"}
      >
        <p className="text-xs text-ink-secondary">{t("businessProfile.languagesHint")}</p>
        <TagChipInput
          label={t("businessProfile.field.supportedLanguages")}
          values={values.supportedLanguages}
          onChange={(supportedLanguages) => patch({ supportedLanguages })}
          suggestions={LANGUAGE_SUGGESTIONS}
        />
      </ProfileCard>

      <ProfileCard
        title={t("businessProfile.section.businessHours")}
        saveFailed={saveStatus === "failed" || saveStatus === "invalid"}
      >
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
