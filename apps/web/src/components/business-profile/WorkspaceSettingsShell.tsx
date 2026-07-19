"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/lib/i18n/provider";

export function WorkspaceSettingsShell({
  slug,
  children,
}: {
  slug: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { t } = useI18n();
  const businessProfileHref = `/w/${slug}/settings/business-profile`;
  const active = pathname === businessProfileHref;

  return (
    <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
      <aside className="rounded-xl border border-border/80 bg-surface p-3 shadow-card lg:sticky lg:top-6 lg:self-start">
        <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-widest text-ink-secondary">
          {t("settings.title")}
        </p>
        <nav aria-label={t("settings.title")}>
          <Link
            href={businessProfileHref}
            className={`block rounded-lg px-3 py-2 text-sm font-medium transition ${
              active
                ? "bg-navy text-white"
                : "text-ink-secondary hover:bg-surface-muted hover:text-navy"
            }`}
          >
            {t("businessProfile.nav")}
          </Link>
        </nav>
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
