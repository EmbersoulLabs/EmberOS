"use client";

import Link from "next/link";
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
  if (pathname === "/workspaces") return null;

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
      className="shrink-0 rounded-lg px-3 py-1.5 text-sm text-orange-100 transition hover:bg-white/10 hover:text-white"
    >
      {t("nav.logout")}
    </button>
  );
}

export function AppShell({
  children,
  workspaceName,
  backHref,
  showBack,
}: {
  children: React.ReactNode;
  workspaceName?: string;
  backHref?: string;
  showBack?: boolean;
}) {
  const pathname = usePathname();
  const { t } = useI18n();
  const resolvedBack = backHref ?? resolveBackHref(pathname);
  const resolvedHome = resolveHomeHref(pathname);
  const canGoBack = showBack ?? resolvedBack !== null;
  const showHome = resolvedHome !== null && pathname !== resolvedHome;

  return (
    <div className="min-h-screen bg-mist">
      <header className="border-b border-orange-200/50 bg-coal text-white shadow-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-1">
            {canGoBack && resolvedBack && (
              <Link
                href={resolvedBack}
                className="mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-orange-100 transition hover:bg-white/10 hover:text-white"
                aria-label={t("nav.back")}
              >
                <BackIcon />
              </Link>
            )}
            {showHome && resolvedHome && (
              <Link
                href={resolvedHome}
                className="mr-1 flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2 text-orange-100 transition hover:bg-white/10 hover:text-white sm:px-2.5"
                aria-label={t("nav.home")}
              >
                <HomeIcon />
                <span className="hidden text-sm font-medium sm:inline">{t("nav.home")}</span>
              </Link>
            )}
            <Link href="/workspaces" className="flex min-w-0 items-center gap-2.5">
              <EmberLogo className="h-8 w-8 shrink-0" />
              <span className="truncate text-lg font-bold tracking-tight">{BRAND.product}</span>
            </Link>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {workspaceName && (
              <span className="rounded-full bg-white/10 px-3 py-1 text-sm text-orange-100 ring-1 ring-orange-400/30">
                {workspaceName}
              </span>
            )}
            <LocaleSwitcher variant="header" />
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  const colors: Record<string, string> = {
    draft: "bg-slate-100 text-slate-700",
    processing: "bg-blue-100 text-blue-700",
    pending_internal_review: "bg-amber-100 text-amber-800",
    pending_client_review: "bg-orange-100 text-orange-900",
    approved: "bg-green-100 text-green-800",
    export_ready: "bg-emerald-100 text-emerald-800",
    failed: "bg-red-100 text-red-700",
    exported: "bg-green-100 text-green-800",
    queued: "bg-slate-100 text-slate-600",
    running: "bg-blue-100 text-blue-700",
    completed: "bg-green-100 text-green-800",
    pending: "bg-slate-100 text-slate-600",
    skipped: "bg-slate-100 text-slate-500",
    compliance_failed: "bg-red-100 text-red-700",
    preview_rendering: "bg-blue-100 text-blue-700",
    preview_ready: "bg-cyan-100 text-cyan-800",
    final_rendering: "bg-indigo-100 text-indigo-800",
    final_ready: "bg-emerald-100 text-emerald-800",
  };

  const key = statusTranslationKey(status);
  const label = key ? t(key) : status.replace(/_/g, " ");

  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${colors[status] ?? "bg-slate-100 text-slate-600"}`}
    >
      {label}
    </span>
  );
}
