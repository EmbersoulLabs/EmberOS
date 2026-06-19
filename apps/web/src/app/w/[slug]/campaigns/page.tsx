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

  useEffect(() => {
    async function load() {
      const meRes = await fetch("/api/me");
      const me = await meRes.json();
      const ws = me.workspaces?.find((w: { slug: string }) => w.slug === slug);
      if (!ws) return;

      setWorkspaceId(ws.id);
      setWorkspaceName(ws.name);

      const res = await fetch(`/api/campaigns?workspaceId=${ws.id}`);
      const data = await res.json();
      setCampaigns(data.campaigns ?? []);
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
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("campaigns.title")}</h1>
        <Link
          href={`/w/${slug}/campaigns/new`}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover"
        >
          {t("campaigns.new")}
        </Link>
      </div>

      {deleteError && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {deleteError}
        </p>
      )}

      <div className="space-y-3">
        {campaigns.map((c) => (
          <div
            key={c.id}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-lg border bg-white p-4 hover:border-primary"
          >
            <Link href={`/w/${slug}/campaigns/${c.id}`} className="min-w-0">
              <h2 className="font-medium">{c.name}</h2>
              <p className="text-sm text-slate-500">
                {CAMPAIGN_GOAL_OPTIONS.find((g) => g.value === c.goal)
                  ? t(CAMPAIGN_GOAL_OPTIONS.find((g) => g.value === c.goal)!.key)
                  : c.goal}
              </p>
            </Link>
            <div className="flex shrink-0 items-center gap-3">
              <StatusBadge status={c.status} />
              {(c.canDelete ?? isCampaignDeletable(c.status)) && (
                <button
                  type="button"
                  disabled={deletingId === c.id}
                  onClick={(e) => deleteCampaign(e, c.id, c.name)}
                  className="rounded border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:cursor-wait disabled:opacity-60"
                >
                  {deletingId === c.id ? t("campaigns.deleting") : t("campaigns.delete")}
                </button>
              )}
            </div>
          </div>
        ))}
        {campaigns.length === 0 && (
          <p className="text-slate-500">{t("campaigns.empty")}</p>
        )}
      </div>
    </AppShell>
  );
}
