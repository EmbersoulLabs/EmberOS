"use client";

import { LOCALES, type Locale } from "@ceo-agent/shared/i18n";
import { useI18n } from "@/lib/i18n/provider";

type Variant = "header" | "light";

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
      ? "rounded-lg border border-white/25 bg-white px-2.5 py-1.5 text-sm font-medium text-coal shadow-sm [color-scheme:light]"
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
          {l.label}
        </option>
      ))}
    </select>
  );
}
