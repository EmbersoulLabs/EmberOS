"use client";

import {
  BGM_USER_PREFERENCES,
  DEFAULT_BGM_PREFERENCE,
  VOICE_PRESETS,
  CONTENT_STYLES,
  CAMPAIGN_MARKETING_GOALS,
  DEFAULT_VOICE_PRESET,
  DEFAULT_BGM_START_PREFERENCE,
  type VoicePreset,
  type ContentStyle,
  type CampaignMarketingGoal,
  type BgmUserPreference,
  type BgmStartPreference,
} from "@ceo-agent/shared";
import type { TranslationKey } from "@ceo-agent/shared/i18n";
import { useI18n } from "@/lib/i18n/provider";

export interface CampaignBriefFormValues {
  campaignBrief: string;
  voicePreset: VoicePreset;
  contentStyle: ContentStyle | "";
  campaignGoal: CampaignMarketingGoal | "";
  bgmPreference: BgmUserPreference;
  bgmStartPreference: BgmStartPreference;
}

export const EMPTY_BRIEF_FORM: CampaignBriefFormValues = {
  campaignBrief: "",
  voicePreset: DEFAULT_VOICE_PRESET,
  contentStyle: "",
  campaignGoal: "",
  bgmPreference: DEFAULT_BGM_PREFERENCE,
  bgmStartPreference: DEFAULT_BGM_START_PREFERENCE,
};

function OptionChip({
  selected,
  onClick,
  label,
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition-all duration-200 ${
        selected
          ? "border-navy bg-navy text-white shadow-sm"
          : "border-border bg-surface text-ink-secondary hover:border-brand-blue/30 hover:bg-surface-muted"
      }`}
    >
      {label}
    </button>
  );
}

export function CampaignBriefForm({
  values,
  onChange,
}: {
  values: CampaignBriefFormValues;
  onChange: (values: CampaignBriefFormValues) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="space-y-6">
      <p className="text-sm text-ink-secondary">{t("campaign.optionalHint")}</p>

      <section className="brand-card bg-surface-muted/50 p-5">
        <div className="mb-3">
          <h2 className="text-sm font-semibold text-navy">{t("campaign.brief.title")}</h2>
          <p className="mt-1 text-xs text-ink-secondary">{t("campaign.brief.description")}</p>
        </div>
        <textarea
          value={values.campaignBrief}
          onChange={(e) => onChange({ ...values, campaignBrief: e.target.value })}
          rows={6}
          placeholder={t("campaign.brief.placeholder")}
          className="w-full resize-y rounded-xl border border-border bg-surface px-4 py-3 text-sm leading-relaxed text-ink placeholder:text-ink-secondary/70 focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
        />
      </section>

      <section className="brand-card p-5">
        <h2 className="mb-1 text-sm font-semibold text-navy">{t("campaign.bgm.title")}</h2>
        <p className="mb-3 text-xs text-ink-secondary">{t("campaign.bgm.description")}</p>
        <div className="flex flex-wrap gap-2">
          {BGM_USER_PREFERENCES.map((pref) => (
            <OptionChip
              key={pref}
              selected={values.bgmPreference === pref}
              onClick={() => onChange({ ...values, bgmPreference: pref })}
              label={t(`campaign.bgm.${pref}` as TranslationKey)}
            />
          ))}
        </div>
      </section>

      <section className="brand-card p-5">
        <h2 className="mb-3 text-sm font-semibold text-navy">{t("campaign.voice.title")}</h2>
        <div className="flex flex-wrap gap-2">
          {VOICE_PRESETS.map((preset) => (
            <OptionChip
              key={preset}
              selected={values.voicePreset === preset}
              onClick={() => onChange({ ...values, voicePreset: preset })}
              label={t(`campaign.voice.${preset}` as TranslationKey)}
            />
          ))}
        </div>
      </section>

      <section className="brand-card p-5">
        <h2 className="mb-3 text-sm font-semibold text-navy">{t("campaign.style.title")}</h2>
        <div className="flex flex-wrap gap-2">
          <OptionChip
            selected={values.contentStyle === ""}
            onClick={() => onChange({ ...values, contentStyle: "" })}
            label={t("campaign.voice.auto")}
          />
          {CONTENT_STYLES.map((style) => (
            <OptionChip
              key={style}
              selected={values.contentStyle === style}
              onClick={() => onChange({ ...values, contentStyle: style })}
              label={t(`campaign.style.${style}` as TranslationKey)}
            />
          ))}
        </div>
      </section>

      <section className="brand-card p-5">
        <h2 className="mb-3 text-sm font-semibold text-navy">{t("campaign.marketingGoal.title")}</h2>
        <div className="flex flex-wrap gap-2">
          <OptionChip
            selected={values.campaignGoal === ""}
            onClick={() => onChange({ ...values, campaignGoal: "" })}
            label={t("campaign.voice.auto")}
          />
          {CAMPAIGN_MARKETING_GOALS.map((goal) => (
            <OptionChip
              key={goal}
              selected={values.campaignGoal === goal}
              onClick={() => onChange({ ...values, campaignGoal: goal })}
              label={t(`campaign.marketingGoal.${goal}` as TranslationKey)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
