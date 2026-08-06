"use client";

import {
  PUBLISHING_PLATFORM_IDS,
  type PublishingPlatformId,
} from "@ceo-agent/shared";
import { useI18n } from "@/lib/i18n/provider";
import type { TranslationKey } from "@ceo-agent/shared/i18n";

const PLATFORM_I18N: Record<PublishingPlatformId, TranslationKey> = {
  tiktok: "marketing.platform.tiktok",
  instagram: "marketing.platform.instagram",
  facebook: "marketing.platform.facebook",
  linkedin: "marketing.platform.linkedin",
  xiaohongshu: "marketing.platform.xiaohongshu",
  googleBusiness: "marketing.platform.googleBusiness",
};

/** PD-042 multi-select for Default / Campaign Publishing Platforms. */
export function PublishingPlatformMultiSelect({
  values,
  onChange,
  disabled,
  label,
  hint,
}: {
  values: string[];
  onChange: (next: PublishingPlatformId[]) => void;
  disabled?: boolean;
  label?: string;
  hint?: string;
}) {
  const { t } = useI18n();
  const selected = new Set(values);

  function toggle(id: PublishingPlatformId) {
    if (disabled) return;
    if (selected.has(id)) {
      onChange(values.filter((v) => v !== id) as PublishingPlatformId[]);
      return;
    }
    onChange([...(values as PublishingPlatformId[]), id]);
  }

  return (
    <fieldset className="space-y-2" disabled={disabled}>
      {label ? (
        <legend className="text-sm font-semibold text-navy">{label}</legend>
      ) : null}
      {hint ? <p className="text-xs text-ink-secondary">{hint}</p> : null}
      <div className="flex flex-wrap gap-2">
        {PUBLISHING_PLATFORM_IDS.map((id) => {
          const active = selected.has(id);
          return (
            <button
              key={id}
              type="button"
              aria-pressed={active}
              disabled={disabled}
              onClick={() => toggle(id)}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
                active
                  ? "border-navy bg-navy text-white"
                  : "border-border bg-white text-navy hover:border-navy/40"
              } disabled:opacity-50`}
            >
              {t(PLATFORM_I18N[id])}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
