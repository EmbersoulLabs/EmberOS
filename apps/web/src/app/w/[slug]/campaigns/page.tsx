"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AppShell, StatusBadge } from "@/components/AppShell";
import { isCampaignDeletable } from "@/lib/campaigns";
import { useI18n } from "@/lib/i18n/provider";
import { CAMPAIGN_GOAL_OPTIONS } from "@ceo-agent/shared/i18n";

interface Campaign {
  id: string;
  name: string;
  status: string;
  goal?: string;
  platforms: string[];
  canDelete?: boolean;
}

export default function CampaignListPage() {
  const params = useParams();
  const slug = params.slug as string;
  const { t } = useI18n();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [workspaceName, setWorkspaceName] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const meRes = await fetch("/api/me");
      const me = await meRes.json();
      const ws = me.workspaces?.find((w: { slug: string }) => w.slug === slug);
      if (!ws) {
        setLoading(false);
        return;
      }

      setWorkspaceId(ws.id);
      setWorkspaceName(ws.name);

      const res = await fetch(`/api/campaigns?workspaceId=${ws.id}`);
      const data = await res.json();
      setCampaigns(data.campaigns ?? []);
      setLoading(false);
    }
    load();
  }, [slug]);

  async function deleteCampaign(e: React.MouseEvent, campaignId: string, campaignName: string) {
    e.preventDefault();
    e.stopPropagation();
    setDeleteError("");
    if (!confirm(t("campaigns.deleteConfirm", { name: campaignName }))) return;

    setDeletingId(campaignId);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        setDeleteError(data.error ?? t("error.deleteCampaign"));
        return;
      }
      setCampaigns((prev) => prev.filter((c) => c.id !== campaignId));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <AppShell workspaceName={workspaceName}>
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-border/70 pb-5">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-widest text-ink-secondary">
              {workspaceName}
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-navy">{t("campaigns.title")}</h1>
            {!loading && campaigns.length > 0 && (
              <p className="mt-1 text-sm text-ink-secondary">
                {t("campaigns.count", { count: campaigns.length })}
              </p>
            )}
          </div>
          <Link
            href={`/w/${slug}/campaigns/new`}
            className="inline-flex h-10 items-center rounded-lg bg-navy px-4 text-sm font-medium text-white shadow-sm hover:bg-navy/90"
          >
            {t("campaigns.new")}
          </Link>
        </div>

        {deleteError && (
          <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {deleteError}
          </p>
        )}

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 animate-pulse rounded-xl border border-border/60 bg-surface-muted/50" />
            ))}
          </div>
        ) : campaigns.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-surface-muted/40 px-6 py-16 text-center">
            <p className="text-sm text-ink-secondary">{t("campaigns.empty")}</p>
            <Link
              href={`/w/${slug}/campaigns/new`}
              className="mt-4 inline-flex h-9 items-center rounded-lg bg-navy px-4 text-sm font-medium text-white"
            >
              {t("campaigns.new")}
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {campaigns.map((c) => (
              <div
                key={c.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-xl border border-border/80 bg-surface p-4 shadow-card transition hover:border-brand-blue/25"
              >
                <Link href={`/w/${slug}/campaigns/${c.id}`} className="min-w-0">
                  <h2 className="font-semibold text-navy">{c.name}</h2>
                  <p className="mt-0.5 text-sm text-ink-secondary">
                    {CAMPAIGN_GOAL_OPTIONS.find((g) => g.value === c.goal)
                      ? t(CAMPAIGN_GOAL_OPTIONS.find((g) => g.value === c.goal)!.key)
                      : c.goal || "—"}
                  </p>
                </Link>
                <div className="flex shrink-0 items-center gap-2">
                  <StatusBadge status={c.status} />
                  {(c.canDelete ?? isCampaignDeletable(c.status)) && (
                    <button
                      type="button"
                      disabled={deletingId === c.id}
                      onClick={(e) => deleteCampaign(e, c.id, c.name)}
                      className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
                    >
                      {deletingId === c.id ? t("campaigns.deleting") : t("campaigns.delete")}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
