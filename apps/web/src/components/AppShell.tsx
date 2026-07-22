"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { BRAND } from "@/lib/brand";
import { EmberLogo } from "@/components/EmberLogo";
import { useI18n } from "@/lib/i18n/provider";
import { statusTranslationKey } from "@ceo-agent/shared/i18n";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { GlobalNavMenu, useLogoutAction, type GlobalNavItem } from "@/components/GlobalNavMenu";

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

  if (rest[0] === "settings") return `/w/${slug}/campaigns`;

  if (rest[0] === "business-profile") return `/w/${slug}/campaigns`;

  if (rest[0] === "assets") return `/w/${slug}/campaigns`;

  return "/workspaces";
}

function workspaceSlugFromPath(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "w" && parts[1]) return parts[1];
  return null;
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
  const handleLogout = useLogoutAction();
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const resolvedBack = backHref ?? resolveBackHref(pathname);
  const resolvedHome = resolveHomeHref(pathname);
  const canGoBack = showBack ?? resolvedBack !== null;
  const showHome = resolvedHome !== null && pathname !== resolvedHome;
  const brandHref = pathname.startsWith("/admin") ? "/admin" : "/workspaces";
  const workspaceSlug = workspaceSlugFromPath(pathname);
  const businessProfileHref = workspaceSlug
    ? `/w/${workspaceSlug}/business-profile`
    : null;
  const businessProfileActive =
    Boolean(workspaceSlug) &&
    (pathname === businessProfileHref ||
      pathname === `/w/${workspaceSlug}/business-profile`);
  const assetsHref = workspaceSlug ? `/w/${workspaceSlug}/assets` : null;
  const assetsActive =
    Boolean(workspaceSlug) &&
    (pathname === assetsHref || pathname.startsWith(`/w/${workspaceSlug}/assets/`));

  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((d) => setIsSuperAdmin(Boolean(d.isSuperAdmin)))
      .catch(() => setIsSuperAdmin(false));
  }, []);

  const navItems = useMemo(() => {
    const items: GlobalNavItem[] = [];
    if (showHome && resolvedHome) {
      items.push({ id: "home", label: t("nav.home"), href: resolvedHome });
    }
    if (businessProfileHref) {
      items.push({
        id: "business-profile",
        label: t("businessProfile.nav"),
        href: businessProfileHref,
        current: businessProfileActive,
      });
    }
    if (assetsHref) {
      items.push({
        id: "assets",
        label: t("assetLibrary.nav"),
        href: assetsHref,
        current: assetsActive,
      });
    }
    if (showAdminNav && isSuperAdmin && !pathname.startsWith("/admin")) {
      items.push({ id: "admin", label: t("nav.admin"), href: "/admin" });
    }
    items.push({
      id: "logout",
      label: t("nav.logout"),
      onClick: () => {
        void handleLogout();
      },
    });
    return items;
  }, [
    showHome,
    resolvedHome,
    businessProfileHref,
    businessProfileActive,
    assetsHref,
    assetsActive,
    showAdminNav,
    isSuperAdmin,
    pathname,
    t,
    handleLogout,
  ]);

  return (
    <div className="min-h-screen bg-surface-muted">
      {/* Global App Bar — global controls only */}
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
              <Link href={brandHref} className="flex min-w-0 items-center gap-2 sm:gap-2.5">
                <EmberLogo className="h-8 w-8 shrink-0 sm:h-9 sm:w-9" />
                <span className="truncate text-base font-bold tracking-tight sm:text-lg">
                  {BRAND.product}
                </span>
              </Link>
            </div>
            <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
              <LocaleSwitcher variant="header" />
              <GlobalNavMenu items={navItems} />
            </div>
          </div>
        </div>
      </header>

      {/* Workspace Header — display only, not a selector */}
      {workspaceName ? (
        <div className="border-b border-border/70 bg-surface">
          <div className="mx-auto max-w-6xl px-3 py-2.5 sm:px-4 sm:py-3">
            <p
              className="truncate text-sm font-semibold tracking-tight text-navy sm:text-base"
              title={workspaceName}
            >
              {workspaceName}
            </p>
          </div>
        </div>
      ) : null}

      <main className="mx-auto max-w-6xl px-3 py-5 sm:px-4 sm:py-8">{children}</main>
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
