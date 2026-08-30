"use client";

import {
  PUBLISHING_PLATFORM_IDS,
  type PublishingPlatformId,
} from "@ceo-agent/shared";
import type { TranslationKey } from "@ceo-agent/shared/i18n";
import { useI18n } from "@/lib/i18n/provider";

const PLATFORM_LABEL_KEYS: Record<PublishingPlatformId, TranslationKey> = {
  tiktok: "marketing.platform.tiktok",
  instagram: "marketing.platform.instagram",
  facebook: "marketing.platform.facebook",
  linkedin: "marketing.platform.linkedin",
  xiaohongshu: "marketing.platform.xiaohongshu",
  googleBusiness: "marketing.platform.googleBusiness",
};

export function DefaultPublishingPlatformSelector({
  values,
  onChange,
  disabled = false,
}: {
  values: readonly PublishingPlatformId[];
  onChange: (values: PublishingPlatformId[]) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const selected = new Set(values);

  return (
    <fieldset disabled={disabled} className="space-y-3">
      <legend className="text-sm font-semibold text-navy">
        {t("businessProfile.field.defaultPublishingPlatforms")}
      </legend>
      <p className="text-xs text-ink-secondary">
        {t("businessProfile.publishingPlatformsHint")}
      </p>
      <div className="flex flex-wrap gap-2">
        {PUBLISHING_PLATFORM_IDS.map((id) => {
          const active = selected.has(id);
          return (
            <button
              key={id}
              type="button"
              aria-pressed={active}
              disabled={disabled}
              onClick={() =>
                onChange(
                  active
                    ? PUBLISHING_PLATFORM_IDS.filter(
                        (candidate) => candidate !== id && selected.has(candidate)
                      )
                    : PUBLISHING_PLATFORM_IDS.filter(
                        (candidate) => candidate === id || selected.has(candidate)
                      )
                )
              }
              className={`rounded-lg border px-3 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40 ${
                active
                  ? "border-navy bg-navy text-white"
                  : "border-border bg-white text-navy hover:border-navy/40"
              } disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {t(PLATFORM_LABEL_KEYS[id])}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
