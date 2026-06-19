"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { BRAND } from "@/lib/brand";
import { useI18n } from "@/lib/i18n/provider";

interface Workspace {
  id: string;
  name: string;
  slug: string;
  role: string;
}

export default function WorkspacesPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [loadError, setLoadError] = useState("");

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
          throw new Error(me.error ?? "Failed to load account");
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
            throw new Error(orgData.error ?? "Failed to create organization");
          }
          resolvedOrgId = orgData.organization.id;
        }

        setOrgId(resolvedOrgId ?? null);

        const wsRes = await fetch("/api/workspaces");
        const wsData = await wsRes.json();
        if (!wsRes.ok) {
          throw new Error(wsData.error ?? "Failed to load workspaces");
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

  async function createWorkspace(e: React.FormEvent) {
    e.preventDefault();
    if (!orgId || !newName) return;

    const res = await fetch("/api/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId, name: newName }),
    });
    const data = await res.json();
    if (data.workspace) {
      setWorkspaces((prev) => [...prev, { ...data.workspace, role: "admin" }]);
      setNewName("");
      setShowCreate(false);
    }
  }

  return (
    <AppShell>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t("workspaces.title")}</h1>
          <p className="text-sm text-slate-500">{t("workspaces.subtitle")}</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover"
        >
          {t("workspaces.new")}
        </button>
      </div>

      {loadError && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {loadError}
        </p>
      )}

      {showCreate && (
        <form onSubmit={createWorkspace} className="mb-6 rounded-lg border bg-white p-4">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t("workspaces.namePlaceholder")}
            className="mb-3 w-full rounded border px-3 py-2 text-sm"
            required
          />
          <div className="flex gap-2">
            <button type="submit" className="rounded bg-primary px-3 py-1.5 text-sm text-white">
              {t("workspaces.create")}
            </button>
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="rounded border px-3 py-1.5 text-sm"
            >
              {t("workspaces.cancel")}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-slate-500">{t("workspaces.loading")}</p>
      ) : workspaces.length === 0 ? (
        <p className="text-slate-500">{t("workspaces.empty")}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {workspaces.map((ws) => (
            <Link
              key={ws.id}
              href={`/w/${ws.slug}/campaigns`}
              className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-primary hover:shadow-md"
            >
              <h2 className="font-semibold text-slate-900">{ws.name}</h2>
              <p className="mt-1 text-sm text-slate-500">{t("workspaces.role", { role: ws.role })}</p>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}
