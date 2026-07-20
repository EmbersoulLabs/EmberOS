"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { BRAND } from "@/lib/brand";
import { useI18n } from "@/lib/i18n/provider";
import type { TranslationKey } from "@ceo-agent/shared/i18n";
import {
  BUSINESS_COUNTRY_OPTIONS,
  INDUSTRY_CUSTOM_ID,
  INDUSTRY_DICTIONARY,
} from "@ceo-agent/shared";

interface Workspace {
  id: string;
  name: string;
  slug: string;
  role: string;
}

function roleLabel(role: string, t: (key: TranslationKey) => string): string {
  const map: Record<string, TranslationKey> = {
    admin: "workspaces.roleAdmin",
    editor: "workspaces.roleEditor",
    operator: "workspaces.roleOperator",
    client_viewer: "workspaces.roleViewer",
  };
  const key = map[role];
  return key ? t(key) : role;
}

export default function WorkspacesPage() {
  const router = useRouter();
  const { t, locale } = useI18n();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [businessName, setBusinessName] = useState("");
  const [country, setCountry] = useState("");
  const [industryId, setIndustryId] = useState("");
  const [industryCustom, setIndustryCustom] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [createError, setCreateError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const meRes = await fetch("/api/me");
        const me = await meRes.json();

        if (!meRes.ok) {
          if (meRes.status === 401) {
            router.replace("/login");
            return;
          }
          throw new Error(me.error ?? t("error.loadAccount"));
        }

        let resolvedOrgId = me.orgs?.[0]?.id as string | undefined;

        if (!resolvedOrgId) {
          const orgRes = await fetch("/api/organizations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: BRAND.defaultOrgName, slug: BRAND.defaultOrgSlug }),
          });
          const orgData = await orgRes.json();
          if (!orgRes.ok || !orgData.organization?.id) {
            throw new Error(orgData.error ?? t("error.createOrganization"));
          }
          resolvedOrgId = orgData.organization.id;
        }

        setOrgId(resolvedOrgId ?? null);

        const wsRes = await fetch("/api/workspaces");
        const wsData = await wsRes.json();
        if (!wsRes.ok) {
          throw new Error(wsData.error ?? t("error.loadWorkspaces"));
        }
        setWorkspaces(wsData.workspaces ?? []);
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : t("error.generic"));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [router, t]);

  function resetCreateForm() {
    setBusinessName("");
    setCountry("");
    setIndustryId("");
    setIndustryCustom("");
    setFieldErrors({});
    setCreateError("");
  }

  function validateForm(): boolean {
    const next: Record<string, string> = {};
    if (!businessName.trim()) next.businessName = t("workspaces.businessNameRequired");
    if (!country.trim()) next.country = t("workspaces.countryRequired");
    if (!industryId.trim()) next.industry = t("workspaces.industryRequired");
    if (industryId === INDUSTRY_CUSTOM_ID && !industryCustom.trim()) {
      next.industryCustom = t("workspaces.industryCustomRequired");
    }
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  }

  async function createWorkspace(e: React.FormEvent) {
    e.preventDefault();
    if (!orgId || creating) return;
    if (!validateForm()) return;

    setCreating(true);
    setCreateError("");
    try {
      const industry =
        industryId === INDUSTRY_CUSTOM_ID ? industryCustom.trim() : industryId;
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId,
          businessName: businessName.trim(),
          country: country.trim(),
          industry,
          locale,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCreateError(data.error ?? t("error.generic"));
        return;
      }
      if (data.workspace?.slug) {
        const redirectTo =
          typeof data.redirectTo === "string"
            ? data.redirectTo
            : `/w/${data.workspace.slug}/settings/business-profile`;
        router.push(redirectTo);
        return;
      }
      setCreateError(t("error.generic"));
    } catch {
      setCreateError(t("error.generic"));
    } finally {
      setCreating(false);
    }
  }

  const industryOptions = [
    ...INDUSTRY_DICTIONARY.map((entry) => ({
      value: entry.id,
      label: entry.labels[locale] ?? entry.labels.en,
    })),
    { value: INDUSTRY_CUSTOM_ID, label: t("businessProfile.industry.custom") },
  ];

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4 border-b border-border/70 pb-6">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-widest text-ink-secondary">
              {t("marketing.brand")}
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-navy sm:text-3xl">
              {t("workspaces.title")}
            </h1>
            <p className="mt-1 text-sm text-ink-secondary">{t("workspaces.subtitle")}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              resetCreateForm();
              setShowCreate(true);
            }}
            className="inline-flex h-10 items-center rounded-lg bg-navy px-4 text-sm font-medium text-white shadow-sm hover:bg-navy/90"
          >
            {t("workspaces.newBusiness")}
          </button>
        </div>

        {loadError && (
          <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {loadError}
          </p>
        )}

        {showCreate && (
          <form
            onSubmit={createWorkspace}
            className="mb-6 space-y-4 rounded-xl border border-border/80 bg-surface p-5 shadow-card"
            noValidate
          >
            <h2 className="text-sm font-semibold text-navy">{t("workspaces.newBusiness")}</h2>
            <p className="text-xs text-ink-secondary">{t("workspaces.newBusinessHint")}</p>

            <div>
              <label className="mb-1.5 block text-sm font-semibold text-navy" htmlFor="businessName">
                {t("workspaces.businessName")}
                <span className="ml-0.5 text-red-500" aria-hidden>
                  *
                </span>
              </label>
              <input
                id="businessName"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder={t("workspaces.businessNamePlaceholder")}
                className="w-full rounded-lg border border-border px-3 py-2.5 text-sm focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
                autoFocus
                disabled={creating}
                aria-invalid={Boolean(fieldErrors.businessName)}
              />
              {fieldErrors.businessName && (
                <p className="mt-1 text-xs text-red-600" role="alert">
                  {fieldErrors.businessName}
                </p>
              )}
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-semibold text-navy" htmlFor="country">
                {t("workspaces.country")}
                <span className="ml-0.5 text-red-500" aria-hidden>
                  *
                </span>
              </label>
              <select
                id="country"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className="w-full rounded-lg border border-border px-3 py-2.5 text-sm focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
                disabled={creating}
                aria-invalid={Boolean(fieldErrors.country)}
              >
                <option value="">{t("workspaces.selectPlaceholder")}</option>
                {BUSINESS_COUNTRY_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              {fieldErrors.country && (
                <p className="mt-1 text-xs text-red-600" role="alert">
                  {fieldErrors.country}
                </p>
              )}
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-semibold text-navy" htmlFor="industry">
                {t("workspaces.industry")}
                <span className="ml-0.5 text-red-500" aria-hidden>
                  *
                </span>
              </label>
              <select
                id="industry"
                value={industryId}
                onChange={(e) => setIndustryId(e.target.value)}
                className="w-full rounded-lg border border-border px-3 py-2.5 text-sm focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
                disabled={creating}
                aria-invalid={Boolean(fieldErrors.industry)}
              >
                <option value="">{t("workspaces.selectPlaceholder")}</option>
                {industryOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              {fieldErrors.industry && (
                <p className="mt-1 text-xs text-red-600" role="alert">
                  {fieldErrors.industry}
                </p>
              )}
              {industryId === INDUSTRY_CUSTOM_ID && (
                <input
                  value={industryCustom}
                  onChange={(e) => setIndustryCustom(e.target.value)}
                  placeholder={t("businessProfile.industryCustomPlaceholder")}
                  className="mt-2 w-full rounded-lg border border-border px-3 py-2.5 text-sm focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
                  disabled={creating}
                  aria-invalid={Boolean(fieldErrors.industryCustom)}
                />
              )}
              {fieldErrors.industryCustom && (
                <p className="mt-1 text-xs text-red-600" role="alert">
                  {fieldErrors.industryCustom}
                </p>
              )}
            </div>

            {createError && (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                {createError}
              </p>
            )}

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={creating}
                className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {creating ? t("workspaces.creating") : t("workspaces.create")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowCreate(false);
                  resetCreateForm();
                }}
                disabled={creating}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-ink-secondary hover:text-navy disabled:opacity-50"
              >
                {t("workspaces.cancel")}
              </button>
            </div>
          </form>
        )}

        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-32 animate-pulse rounded-xl border border-border/60 bg-surface-muted/50" />
            ))}
          </div>
        ) : workspaces.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-surface-muted/40 px-6 py-16 text-center">
            <p className="text-sm font-medium text-navy">{t("workspaces.empty")}</p>
            <button
              type="button"
              onClick={() => {
                resetCreateForm();
                setShowCreate(true);
              }}
              className="mt-4 inline-flex h-9 items-center rounded-lg border border-navy/20 bg-navy/[0.04] px-4 text-sm font-medium text-navy hover:bg-navy/[0.08]"
            >
              {t("workspaces.newBusiness")}
            </button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {workspaces.map((ws) => (
              <Link
                key={ws.id}
                href={`/w/${ws.slug}/campaigns`}
                className="group flex flex-col rounded-xl border border-border/80 bg-surface p-5 shadow-card transition hover:border-brand-blue/30 hover:shadow-elevated"
              >
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-base font-semibold text-navy group-hover:text-brand-blue">
                    {ws.name}
                  </h2>
                  <span className="shrink-0 rounded-md bg-surface-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-secondary">
                    {roleLabel(ws.role, t)}
                  </span>
                </div>
                <p className="mt-3 text-xs text-ink-secondary">/{ws.slug}</p>
                <span className="mt-4 inline-flex items-center text-xs font-medium text-brand-blue">
                  {t("workspaces.enter")}
                  <svg
                    className="ml-1 h-3.5 w-3.5 transition group-hover:translate-x-0.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
