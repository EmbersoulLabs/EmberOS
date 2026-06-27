"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { AppShell, StatusBadge } from "@/components/AppShell";
import { AdminWorkspaceMembersPanel } from "@/components/admin/AdminWorkspaceMembersPanel";
import { useI18n } from "@/lib/i18n/provider";

interface Overview {
  summary: {
    organizations: number;
    workspaces: number;
    campaigns: number;
    pendingReviews: number;
    failedTasks: number;
  };
  workspaces: Array<{
    id: string;
    name: string;
    slug: string;
    orgName: string;
    campaigns: number;
    pendingReviews: number;
    complianceFailed: number;
  }>;
  campaignStatuses: Array<{ status: string; count: number }>;
  recentFailedTasks: Array<{
    id: string;
    campaignId: string;
    workspaceId: string;
    errorMessage: string | null;
    createdAt: string | null;
  }>;
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border/80 bg-surface p-4 shadow-card">
      <p className="text-[11px] font-medium uppercase tracking-wide text-ink-secondary">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-navy">{value}</p>
    </div>
  );
}

export default function AdminDashboardPage() {
  const { t } = useI18n();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [membersWorkspaceId, setMembersWorkspaceId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/overview")
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? t("error.generic"));
        setData(body);
      })
      .catch((err) => setError(err instanceof Error ? err.message : t("error.generic")))
      .finally(() => setLoading(false));
  }, [t]);

  return (
    <AppShell showAdminNav={false}>
      <div className="mx-auto max-w-6xl">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-border/70 pb-5">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-widest text-ink-secondary">
              {t("admin.eyebrow")}
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-navy">{t("admin.title")}</h1>
            <p className="mt-1 text-sm text-ink-secondary">{t("admin.subtitle")}</p>
          </div>
          <Link
            href="/workspaces"
            className="inline-flex h-10 items-center rounded-lg border border-border px-4 text-sm font-medium text-navy hover:bg-surface-muted"
          >
            {t("admin.openWorkspaces")}
          </Link>
        </header>

        {error && (
          <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        )}

        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-xl bg-surface-muted" />
            ))}
          </div>
        ) : data ? (
          <div className="space-y-8">
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <StatCard label={t("admin.stat.orgs")} value={data.summary.organizations} />
              <StatCard label={t("admin.stat.workspaces")} value={data.summary.workspaces} />
              <StatCard label={t("admin.stat.campaigns")} value={data.summary.campaigns} />
              <StatCard label={t("admin.stat.pendingReviews")} value={data.summary.pendingReviews} />
              <StatCard label={t("admin.stat.failedTasks")} value={data.summary.failedTasks} />
            </section>

            {data.campaignStatuses.length > 0 && (
              <section className="rounded-xl border border-border/80 bg-surface p-4 shadow-card sm:p-5">
                <h2 className="text-sm font-semibold text-navy">{t("admin.campaignFunnel")}</h2>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {data.campaignStatuses.map((row) => (
                    <li key={row.status} className="flex items-center gap-2 rounded-lg bg-surface-muted px-3 py-1.5 text-sm">
                      <StatusBadge status={row.status} />
                      <span className="font-medium tabular-nums text-navy">{row.count}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="rounded-xl border border-border/80 bg-surface shadow-card">
              <div className="border-b border-border/60 px-4 py-3 sm:px-5">
                <h2 className="text-sm font-semibold text-navy">{t("admin.workspacesTitle")}</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/60 text-left text-[11px] uppercase tracking-wide text-ink-secondary">
                      <th className="px-4 py-2.5 sm:px-5">{t("admin.col.workspace")}</th>
                      <th className="px-4 py-2.5">{t("admin.col.org")}</th>
                      <th className="px-4 py-2.5 text-right">{t("admin.col.campaigns")}</th>
                      <th className="px-4 py-2.5 text-right">{t("admin.col.pending")}</th>
                      <th className="px-4 py-2.5 text-right">{t("admin.col.rejected")}</th>
                      <th className="px-4 py-2.5 sm:px-5" />
                    </tr>
                  </thead>
                  <tbody>
                    {data.workspaces.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-ink-secondary sm:px-5">
                          {t("admin.noWorkspaces")}
                        </td>
                      </tr>
                    ) : (
                      data.workspaces.map((ws) => (
                        <Fragment key={ws.id}>
                          <tr className="border-b border-border/40">
                            <td className="px-4 py-3 font-medium text-navy sm:px-5">
                              {ws.name}
                              <span className="mt-0.5 block text-xs font-normal text-ink-secondary">/{ws.slug}</span>
                            </td>
                            <td className="px-4 py-3 text-ink-secondary">{ws.orgName}</td>
                            <td className="px-4 py-3 text-right tabular-nums">{ws.campaigns}</td>
                            <td className="px-4 py-3 text-right tabular-nums">{ws.pendingReviews}</td>
                            <td className="px-4 py-3 text-right tabular-nums">{ws.complianceFailed}</td>
                            <td className="px-4 py-3 text-right sm:px-5">
                              <div className="flex flex-wrap items-center justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setMembersWorkspaceId((cur) => (cur === ws.id ? null : ws.id))
                                  }
                                  className="text-xs font-medium text-navy hover:underline"
                                >
                                  {membersWorkspaceId === ws.id
                                    ? t("admin.members.hide")
                                    : t("admin.members.manage")}
                                </button>
                                <Link
                                  href={`/w/${ws.slug}/campaigns`}
                                  className="text-xs font-medium text-brand-blue hover:underline"
                                >
                                  {t("admin.open")}
                                </Link>
                              </div>
                            </td>
                          </tr>
                          {membersWorkspaceId === ws.id && (
                            <tr>
                              <td colSpan={6} className="p-0">
                                <AdminWorkspaceMembersPanel
                                  workspaceId={ws.id}
                                  workspaceName={ws.name}
                                  onClose={() => setMembersWorkspaceId(null)}
                                />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            {data.recentFailedTasks.length > 0 && (
              <section className="rounded-xl border border-red-200/80 bg-red-50/40 p-4 sm:p-5">
                <h2 className="text-sm font-semibold text-red-900">{t("admin.failedTasksTitle")}</h2>
                <ul className="mt-3 space-y-2">
                  {data.recentFailedTasks.map((task) => (
                    <li key={task.id} className="rounded-lg border border-red-200/60 bg-white px-3 py-2 text-sm">
                      <p className="font-mono text-xs text-ink-secondary">{task.id.slice(0, 8)}…</p>
                      <p className="mt-1 text-red-800">{task.errorMessage ?? t("admin.noErrorMessage")}</p>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
