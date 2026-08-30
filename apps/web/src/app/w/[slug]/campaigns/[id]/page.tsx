"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  CampaignDashboard,
  type CampaignDashboardData,
} from "@/components/campaign/CampaignDashboard";
import { isCampaignDeletable } from "@/lib/campaigns";
import { useI18n } from "@/lib/i18n/provider";

export default function CampaignDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { t } = useI18n();
  const slug = params.slug as string;
  const id = params.id as string;

  const [data, setData] = useState<CampaignDashboardData | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const loadCampaign = useCallback(async () => {
    const res = await fetch(`/api/campaigns/${id}`);
    if (!res.ok) return null;
    const body = await res.json();
    return body as CampaignDashboardData;
  }, [id]);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      const next = await loadCampaign();
      if (cancelled || !next) return;
      setData(next);
    }

    refresh();

    return () => {
      cancelled = true;
    };
  }, [loadCampaign]);

  async function deleteCampaign() {
    const name = (data?.campaign?.name as string) ?? "this campaign";
    setDeleteError("");
    if (!confirm(t("campaigns.deleteConfirm", { name }))) return;

    setDeleting(true);
    try {
      const res = await fetch(`/api/campaigns/${id}`, { method: "DELETE" });
      const body = await res.json();
      if (!res.ok) {
        setDeleteError(body.error ?? t("error.deleteCampaign"));
        return;
      }
      router.push(`/w/${slug}/campaigns`);
    } finally {
      setDeleting(false);
    }
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-12">
        <div className="h-8 w-48 animate-pulse rounded-lg bg-surface-muted" />
        <div className="mt-6 grid gap-5 lg:grid-cols-2">
          <div className="h-40 animate-pulse rounded-xl bg-surface-muted/60" />
          <div className="h-40 animate-pulse rounded-xl bg-surface-muted/60" />
        </div>
      </div>
    );
  }

  const canDelete =
    data.canDelete ??
    isCampaignDeletable(
      data.campaign.status as string,
      data.task?.status as string | undefined,
      (data.task?.stepProgress as Record<string, { status?: string }>) ?? null
    );

  return (
    <CampaignDashboard
      slug={slug}
      campaignId={id}
      data={{ ...data, canDelete }}
      deleting={deleting}
      deleteError={deleteError}
      onDelete={deleteCampaign}
    />
  );
}
