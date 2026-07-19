"use client";

import { useI18n } from "@/lib/i18n/provider";

interface ProfileCardProps {
  title: string;
  incomplete?: boolean;
  saveFailed?: boolean;
  children: React.ReactNode;
}

export function ProfileCard({ title, incomplete, saveFailed, children }: ProfileCardProps) {
  const { t } = useI18n();

  return (
    <section
      className={`brand-card p-6 ${incomplete ? "ring-1 ring-amber-300/80" : ""} ${saveFailed ? "ring-1 ring-red-300/80" : ""}`}
      aria-label={title}
    >
      <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-navy">{title}</h2>
        {incomplete && (
          <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800">
            {t("businessProfile.card.incomplete")}
          </span>
        )}
        {saveFailed && (
          <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-700">
            {t("businessProfile.card.saveFailed")}
          </span>
        )}
      </div>
      <div className="space-y-5">{children}</div>
    </section>
  );
}
