"use client";

import type { ContentLocale } from "@ceo-agent/shared";
import { CAMPAIGN_OBJECTIVE_ENTRIES } from "@ceo-agent/shared";
import type { TranslationKey } from "@ceo-agent/shared/i18n";
import { useI18n } from "@/lib/i18n/provider";

export const WIZARD_STEPS = [
  "name",
  "objective",
  "upload",
  "brief",
  "language",
  "generate",
] as const;

export type WizardStep = (typeof WIZARD_STEPS)[number];

interface StepperProps {
  current: WizardStep;
}

export function CampaignWizardStepper({ current }: StepperProps) {
  const { t } = useI18n();
  const currentIndex = WIZARD_STEPS.indexOf(current);

  return (
    <ol className="mb-8 flex flex-wrap gap-2">
      {WIZARD_STEPS.map((step, index) => {
        const done = index < currentIndex;
        const active = step === current;
        return (
          <li
            key={step}
            className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ${
              active
                ? "bg-navy text-white"
                : done
                  ? "bg-emerald-50 text-emerald-800"
                  : "bg-surface-muted text-ink-secondary"
            }`}
          >
            <span className="font-mono">{index + 1}</span>
            {t(`campaign.wizard.steps.${step}` as TranslationKey)}
          </li>
        );
      })}
    </ol>
  );
}

interface ObjectiveProps {
  objectiveId: string;
  customValue: string;
  onObjectiveId: (id: string) => void;
  onCustomValue: (v: string) => void;
}

export function CampaignObjectiveFields({
  objectiveId,
  customValue,
  onObjectiveId,
  onCustomValue,
}: ObjectiveProps) {
  const { t } = useI18n();

  return (
    <section className="brand-card p-6">
      <label className="mb-2 block text-sm font-semibold text-navy">
        {t("campaign.workspace.objective.title")}
      </label>
      <select
        value={objectiveId}
        onChange={(e) => onObjectiveId(e.target.value)}
        className="w-full rounded-xl border border-border px-4 py-2.5 text-sm"
        required
      >
        <option value="">{t("campaign.workspace.objective.select")}</option>
        {CAMPAIGN_OBJECTIVE_ENTRIES.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {t(entry.labelKey as TranslationKey)}
          </option>
        ))}
      </select>
      {objectiveId === "custom" && (
        <input
          value={customValue}
          onChange={(e) => onCustomValue(e.target.value)}
          className="mt-3 w-full rounded-xl border border-border px-4 py-2.5 text-sm"
          placeholder={t("campaign.workspace.objective.customPlaceholder")}
          required
        />
      )}
    </section>
  );
}

interface LanguageProps {
  languages: Record<"outputLanguage" | "subtitleLanguage" | "ctaLanguage" | "hashtagLanguage", ContentLocale>;
  suggested?: Partial<Record<"outputLanguage" | "subtitleLanguage" | "ctaLanguage" | "hashtagLanguage", ContentLocale>>;
  onChange: (field: keyof LanguageProps["languages"], value: ContentLocale) => void;
  onAcceptSuggestion?: () => void;
}

const LANG_FIELDS = [
  "outputLanguage",
  "subtitleLanguage",
  "ctaLanguage",
  "hashtagLanguage",
] as const;

export function CampaignLanguageFields({
  languages,
  suggested,
  onChange,
  onAcceptSuggestion,
}: LanguageProps) {
  const { t } = useI18n();
  const hasSuggestion = suggested && Object.keys(suggested).length > 0;

  return (
    <section className="brand-card p-6 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-navy">{t("campaign.wizard.languageTitle")}</h2>
        <p className="mt-1 text-sm text-ink-secondary">{t("campaign.wizard.languageHint")}</p>
      </div>
      {hasSuggestion && onAcceptSuggestion && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          <p>{t("campaign.wizard.languageSuggestion")}</p>
          <button
            type="button"
            onClick={onAcceptSuggestion}
            className="mt-2 text-sm font-medium underline"
          >
            {t("campaign.wizard.acceptSuggestion")}
          </button>
        </div>
      )}
      {LANG_FIELDS.map((field) => (
        <div key={field}>
          <label className="mb-1 block text-sm font-medium text-navy">
            {t(`campaign.workspace.language.${field.replace("Language", "").toLowerCase()}` as TranslationKey)}
          </label>
          <select
            value={languages[field]}
            onChange={(e) => onChange(field, e.target.value as ContentLocale)}
            className="w-full rounded-xl border border-border px-4 py-2.5 text-sm"
          >
            <option value="en">{t("campaign.workspace.language.en")}</option>
            <option value="zh">{t("campaign.workspace.language.zh")}</option>
            <option value="ms">{t("campaign.workspace.language.ms")}</option>
          </select>
        </div>
      ))}
    </section>
  );
}
