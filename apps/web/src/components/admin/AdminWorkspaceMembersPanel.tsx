"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/provider";
import type { TranslationKey } from "@ceo-agent/shared/i18n";

const ROLES = ["admin", "operator", "editor", "reviewer", "publisher", "client_viewer"] as const;

const ROLE_I18N: Record<(typeof ROLES)[number], TranslationKey> = {
  admin: "workspaces.roleAdmin",
  operator: "workspaces.roleOperator",
  editor: "workspaces.roleEditor",
  reviewer: "admin.roleReviewer",
  publisher: "admin.rolePublisher",
  client_viewer: "workspaces.roleViewer",
};

interface Member {
  id: string;
  userId: string;
  role: string;
  email: string | null;
  createdAt: string | null;
}

export function AdminWorkspaceMembersPanel({
  workspaceId,
  workspaceName,
  onClose,
}: {
  workspaceId: string;
  workspaceName: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<(typeof ROLES)[number]>("operator");
  const [submitting, setSubmitting] = useState(false);

  const loadMembers = useCallback(async () => {
    setError("");
    const res = await fetch(`/api/admin/workspaces/${workspaceId}/members`);
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? t("error.generic"));
    setMembers(body.members ?? []);
  }, [workspaceId, t]);

  useEffect(() => {
    loadMembers()
      .catch((err) => setError(err instanceof Error ? err.message : t("error.generic")))
      .finally(() => setLoading(false));
  }, [loadMembers, t]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/admin/workspaces/${workspaceId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), role }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? t("error.generic"));
      setEmail("");
      setSuccess(t("admin.members.added"));
      await loadMembers();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("error.generic"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRoleChange(userId: string, newRole: string) {
    setError("");
    setSuccess("");
    const res = await fetch(`/api/admin/workspaces/${workspaceId}/members/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: newRole }),
    });
    const body = await res.json();
    if (!res.ok) {
      setError(body.error ?? t("error.generic"));
      return;
    }
    setSuccess(t("admin.members.updated"));
    await loadMembers();
  }

  async function handleRemove(userId: string) {
    if (!confirm(t("admin.members.removeConfirm"))) return;
    setError("");
    setSuccess("");
    const res = await fetch(`/api/admin/workspaces/${workspaceId}/members/${userId}`, {
      method: "DELETE",
    });
    const body = await res.json();
    if (!res.ok) {
      setError(body.error ?? t("error.generic"));
      return;
    }
    setSuccess(t("admin.members.removed"));
    await loadMembers();
  }

  return (
    <div className="border-t border-border/60 bg-surface-muted/30 px-4 py-4 sm:px-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-navy">
          {t("admin.members.title")} — {workspaceName}
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="text-xs font-medium text-ink-secondary hover:text-navy"
        >
          {t("admin.members.close")}
        </button>
      </div>

      {error && (
        <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {success && (
        <p className="mb-3 rounded-lg border border-brand-teal/30 bg-brand-teal/5 px-3 py-2 text-sm text-brand-teal">
          {success}
        </p>
      )}

      <form onSubmit={handleAdd} className="mb-4 flex flex-wrap items-end gap-2">
        <div className="min-w-[200px] flex-1">
          <label className="text-[11px] font-medium uppercase tracking-wide text-ink-secondary">
            {t("admin.members.email")}
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="user@example.com"
            required
            className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
          />
        </div>
        <div>
          <label className="text-[11px] font-medium uppercase tracking-wide text-ink-secondary">
            {t("admin.members.role")}
          </label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as (typeof ROLES)[number])}
            className="mt-1 block rounded-lg border border-border bg-white px-3 py-2 text-sm"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {t(ROLE_I18N[r])}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="h-[38px] rounded-lg bg-navy px-4 text-sm font-medium text-white disabled:opacity-60"
        >
          {submitting ? t("admin.members.adding") : t("admin.members.add")}
        </button>
      </form>
      <p className="mb-3 text-xs text-ink-secondary">{t("admin.members.signupHint")}</p>

      {loading ? (
        <p className="text-sm text-ink-secondary">{t("workspaces.loading")}</p>
      ) : members.length === 0 ? (
        <p className="text-sm text-ink-secondary">{t("admin.members.empty")}</p>
      ) : (
        <ul className="divide-y divide-border/60 rounded-lg border border-border/60 bg-surface">
          {members.map((m) => (
            <li
              key={m.id}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-navy">{m.email ?? m.userId}</p>
                <p className="text-xs text-ink-secondary">{m.userId.slice(0, 8)}…</p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={m.role}
                  onChange={(e) => handleRoleChange(m.userId, e.target.value)}
                  className="rounded-md border border-border bg-white px-2 py-1 text-xs"
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {t(ROLE_I18N[r])}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => handleRemove(m.userId)}
                  className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                >
                  {t("admin.members.remove")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
