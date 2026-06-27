"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { BRAND } from "@/lib/brand";
import { EmberLogo } from "@/components/EmberLogo";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n/provider";
import { statusTranslationKey } from "@ceo-agent/shared/i18n";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";

function resolveHomeHref(pathname: string): string | null {
  if (pathname === "/workspaces") return null;

  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "w" && parts[1]) {
    const slug = parts[1];
    const rest = parts.slice(2);
    if (rest[0] === "campaigns" && rest.length === 1) return "/workspaces";
    return `/w/${slug}/campaigns`;
  }

  return "/workspaces";
}

function resolveBackHref(pathname: string): string | null {
  if (pathname === "/workspaces" || pathname === "/admin") return null;

  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "w" || !parts[1]) return "/workspaces";

  const slug = parts[1];
  const rest = parts.slice(2);

  if (rest[0] === "campaigns") {
    if (rest.length === 1) return "/workspaces";
    if (rest[1] === "new") return `/w/${slug}/campaigns`;
    if (rest.length === 2) return `/w/${slug}/campaigns`;
    if (rest[2] === "task") return `/w/${slug}/campaigns/${rest[1]}`;
  }

  if (rest[0] === "creatives") {
    if (rest[2] === "export") return `/w/${slug}/creatives/${rest[1]}`;
    if (rest.length === 2) return `/w/${slug}/campaigns`;
  }

  if (rest[0] === "reviews") return `/w/${slug}/campaigns`;

  return "/workspaces";
}

function HomeIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7A1 1 0 003 10.414V17a1 1 0 001 1h4a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1h4a1 1 0 001-1v-6.586a1 1 0 00-.293-.707l-7-7z" />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path
        fillRule="evenodd"
        d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path
        fillRule="evenodd"
        d="M3 3a1 1 0 00-1 1v12a1 1 0 102 0V4a1 1 0 00-1-1zm10.293 9.293a1 1 0 001.414 0l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L14.586 9H7a1 1 0 100 2h7.586l-1.293 1.293z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function LogoutButton() {
  const router = useRouter();
  const { t } = useI18n();

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      aria-label={t("nav.logout")}
      className="flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg px-2 text-sm text-white/70 transition hover:bg-white/10 hover:text-white sm:px-3"
    >
      <LogoutIcon />
      <span className="hidden sm:inline">{t("nav.logout")}</span>
    </button>
  );
}

export function AppShell({
  children,
  workspaceName,
  backHref,
  showBack,
  showAdminNav = true,
}: {
  children: React.ReactNode;
  workspaceName?: string;
  backHref?: string;
  showBack?: boolean;
  showAdminNav?: boolean;
}) {
  const pathname = usePathname();
  const { t } = useI18n();
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const resolvedBack = backHref ?? resolveBackHref(pathname);
  const resolvedHome = resolveHomeHref(pathname);
  const canGoBack = showBack ?? resolvedBack !== null;
  const showHome = resolvedHome !== null && pathname !== resolvedHome;
  const showHomeButton = showHome && (!canGoBack || resolvedBack !== resolvedHome);
  const brandHref = pathname.startsWith("/admin") ? "/admin" : "/workspaces";

  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((d) => setIsSuperAdmin(Boolean(d.isSuperAdmin)))
      .catch(() => setIsSuperAdmin(false));
  }, []);

  return (
    <div className="min-h-screen bg-surface-muted">
      <header className="border-b border-navy-light/30 bg-navy text-white shadow-elevated">
        <div className="mx-auto max-w-6xl px-3 sm:px-4">
          <div className="flex items-center justify-between gap-2 py-2 sm:gap-3 sm:py-3">
            <div className="flex min-w-0 flex-1 items-center gap-0.5 sm:gap-1">
              {canGoBack && resolvedBack && (
                <Link
                  href={resolvedBack}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white/70 transition hover:bg-white/10 hover:text-white"
                  aria-label={t("nav.back")}
                >
                  <BackIcon />
                </Link>
              )}
              {showHomeButton && resolvedHome && (
                <Link
                  href={resolvedHome}
                  className="hidden h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-white/70 transition hover:bg-white/10 hover:text-white sm:flex"
                  aria-label={t("nav.home")}
                >
                  <HomeIcon />
                  <span className="text-sm font-medium">{t("nav.home")}</span>
                </Link>
              )}
              <Link href={brandHref} className="flex min-w-0 items-center gap-2 sm:gap-2.5">
                <EmberLogo className="h-8 w-8 shrink-0 sm:h-9 sm:w-9" />
                <span className="truncate text-base font-bold tracking-tight sm:text-lg">
                  {BRAND.product}
                </span>
              </Link>
            </div>
            <div className="flex shrink-0 items-center gap-1 sm:gap-2">
              {showAdminNav && isSuperAdmin && !pathname.startsWith("/admin") && (
                <Link
                  href="/admin"
                  className="rounded-lg bg-white/10 px-2 py-1.5 text-[11px] font-medium text-white ring-1 ring-white/15 hover:bg-white/15 sm:px-2.5 sm:text-xs"
                >
                  {t("nav.admin")}
                </Link>
              )}
              {workspaceName && (
                <span className="hidden max-w-[8rem] truncate rounded-full bg-white/10 px-2.5 py-1 text-xs text-white/90 ring-1 ring-white/15 sm:inline-block sm:max-w-[10rem] sm:px-3 sm:text-sm md:max-w-none">
                  {workspaceName}
                </span>
              )}
              <LocaleSwitcher variant="header" />
              <LogoutButton />
            </div>
          </div>
          {workspaceName && (
            <div className="border-t border-white/10 pb-2 sm:hidden">
              <p className="truncate px-0.5 text-xs font-medium text-white/80">{workspaceName}</p>
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-3 py-6 sm:px-4 sm:py-8">{children}</main>
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  const colors: Record<string, string> = {
    draft: "bg-slate-100 text-slate-700",
    processing: "bg-brand-blue/10 text-brand-blue",
    pending_internal_review: "bg-brand-amber/10 text-brand-amber",
    pending_client_review: "bg-brand-amber/10 text-brand-amber",
    approved: "bg-brand-teal/10 text-brand-teal",
    export_ready: "bg-brand-teal/10 text-brand-teal",
    failed: "bg-red-100 text-red-700",
    exported: "bg-brand-teal/10 text-brand-teal",
    queued: "bg-slate-100 text-ink-secondary",
    running: "bg-brand-blue/10 text-brand-blue",
    completed: "bg-brand-teal/10 text-brand-teal",
    pending: "bg-slate-100 text-ink-secondary",
    skipped: "bg-slate-100 text-slate-500",
    compliance_failed: "bg-red-100 text-red-700",
    preview_rendering: "bg-brand-blue/10 text-brand-blue",
    preview_ready: "bg-brand-teal/10 text-brand-teal",
    final_rendering: "bg-brand-blue/10 text-brand-blue",
    final_ready: "bg-brand-teal/10 text-brand-teal",
  };

  const key = statusTranslationKey(status);
  const label = key ? t(key) : status.replace(/_/g, " ");

  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${colors[status] ?? "bg-slate-100 text-ink-secondary"}`}
    >
      {label}
    </span>
  );
}
