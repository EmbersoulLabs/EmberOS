"use client";

import { useEffect, useState } from "react";
import type { SubtitleLanguagePair, SubtitleStylePreset } from "@ceo-agent/shared";
import type { TranslationKey } from "@ceo-agent/shared/i18n";
import { useI18n } from "@/lib/i18n/provider";
import {
  getSubtitleLanguage,
  getSubtitleStyle,
  setSubtitleLanguage,
  setSubtitleStyle,
} from "@/lib/preferences";

const SUBTITLE_LANG_OPTIONS: SubtitleLanguagePair[] = [
  "zh",
  "en",
  "ms",
  "zh_en",
  "en_zh",
  "zh_ms",
  "en_ms",
];

const SUBTITLE_STYLE_OPTIONS: SubtitleStylePreset[] = ["minimal", "corporate", "modern", "social"];

function Chip({
  selected,
  onClick,
  label,
  disabled,
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition disabled:opacity-50 ${
        selected
          ? "border-navy bg-navy text-white"
          : "border-border bg-surface text-ink-secondary hover:border-brand-blue/30"
      }`}
    >
      {label}
    </button>
  );
}

export function CreativeSubtitleSettings({
  creativeId,
  variantId,
  disabled,
  onApplied,
}: {
  creativeId: string;
  variantId: string;
  disabled?: boolean;
  onApplied?: () => void;
}) {
  const { t } = useI18n();
  const [lang, setLang] = useState<SubtitleLanguagePair>("zh_en");
  const [style, setStyle] = useState<SubtitleStylePreset>("minimal");
  const [applying, setApplying] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setLang(getSubtitleLanguage());
    setStyle(getSubtitleStyle());
  }, []);

  async function apply() {
    setApplying(true);
    setMessage("");
    setSubtitleLanguage(lang);
    setSubtitleStyle(style);
    try {
      const res = await fetch(`/api/creatives/${creativeId}/copy`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          variantId,
          renderPreferences: { subtitleLanguage: lang, subtitleStyle: style },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? t("error.generic"));
      setMessage(t("creative.subtitleSettings.applied"));
      onApplied?.();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : t("error.generic"));
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="rounded-xl border border-border/80 bg-surface p-4 shadow-card">
      <h3 className="text-sm font-semibold text-navy">{t("settings.subtitleStyle.title")}</h3>
      <p className="mt-0.5 text-xs text-ink-secondary">{t("creative.subtitleSettings.hint")}</p>

      <div className="mt-3">
        <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-ink-secondary">
          {t("settings.subtitleLanguage.title")}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {SUBTITLE_LANG_OPTIONS.map((opt) => (
            <Chip
              key={opt}
              selected={lang === opt}
              disabled={disabled || applying}
              onClick={() => setLang(opt)}
              label={t(`settings.subtitleLanguage.${opt}` as TranslationKey)}
            />
          ))}
        </div>
      </div>

      <div className="mt-3">
        <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-ink-secondary">
          {t("settings.subtitleStyle.title")}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {SUBTITLE_STYLE_OPTIONS.map((opt) => (
            <Chip
              key={opt}
              selected={style === opt}
              disabled={disabled || applying}
              onClick={() => setStyle(opt)}
              label={t(`settings.subtitleStyle.${opt}` as TranslationKey)}
            />
          ))}
        </div>
      </div>

      <button
        type="button"
        disabled={disabled || applying}
        onClick={() => void apply()}
        className="mt-4 w-full rounded-lg border border-navy/20 bg-navy/[0.04] py-2 text-xs font-medium text-navy transition hover:bg-navy/[0.08] disabled:opacity-50"
      >
        {applying ? t("creative.subtitleSettings.applying") : t("creative.subtitleSettings.apply")}
      </button>

      {message && <p className="mt-2 text-xs text-brand-blue">{message}</p>}
    </div>
  );
}
