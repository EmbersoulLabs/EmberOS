"use client";

import { LOCALES, type Locale } from "@ceo-agent/shared/i18n";
import { useI18n } from "@/lib/i18n/provider";

type Variant = "header" | "light";

const HEADER_LOCALE_LABELS: Record<Locale, string> = {
  en: "EN",
  zh: "中文",
  ms: "MS",
};

export function LocaleSwitcher({
  className,
  variant = "light",
}: {
  className?: string;
  variant?: Variant;
}) {
  const { locale, setLocale } = useI18n();

  const variantClass =
    variant === "header"
      ? "rounded-md border border-white/25 bg-white px-1.5 py-1 text-xs font-semibold text-coal shadow-sm [color-scheme:light] sm:rounded-lg sm:px-2.5 sm:py-1.5 sm:text-sm sm:font-medium"
      : "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-medium text-coal [color-scheme:light]";

  return (
    <select
      value={locale}
      onChange={(e) => setLocale(e.target.value as Locale)}
      className={className ?? variantClass}
      style={{ colorScheme: "light" }}
      aria-label="Language"
    >
      {LOCALES.map((l) => (
        <option key={l.code} value={l.code} className="bg-white text-coal">
          {variant === "header" ? HEADER_LOCALE_LABELS[l.code] : l.label}
        </option>
      ))}
    </select>
  );
}
