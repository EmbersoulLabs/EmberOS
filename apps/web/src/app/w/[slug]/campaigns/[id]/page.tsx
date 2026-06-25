"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { AppShell, StatusBadge } from "@/components/AppShell";
import { RunCeoButton } from "@/components/RunCeoButton";
import { isCampaignDeletable } from "@/lib/campaigns";
import { useI18n } from "@/lib/i18n/provider";

export default function CampaignDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { t } = useI18n();
  const slug = params.slug as string;
  const id = params.id as string;
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  useEffect(() => {
    fetch(`/api/campaigns/${id}`)
      .then((r) => r.json())
      .then(setData);
  }, [id]);

  const campaign = data?.campaign as Record<string, unknown> | undefined;
  const task = data?.task as Record<string, unknown> | null;
  const creative = data?.creative as Record<string, unknown> | null;
  const clipCount = (data?.clipCount as number | undefined) ?? 0;
  const hasVideoAsset = Boolean(data?.hasVideoAsset);
  const status = campaign?.status as string | undefined;
  const taskStatus = task?.status as string | undefined;
  const stepProgress = (task?.stepProgress ?? null) as Record<string, { status?: string }> | null;
  const canDelete =
    (data?.canDelete as boolean | undefined) ??
    (status ? isCampaignDeletable(status, taskStatus, stepProgress) : false);

  async function deleteCampaign() {
    const name = (campaign?.name as string) ?? "this campaign";
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

  return (
    <AppShell>
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{(campaign?.name as string) ?? "Campaign"}</h1>
        {campaign && <StatusBadge status={status!} />}
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          href={`/w/${slug}/campaigns/${id}/task${task?.id ? `?taskId=${task.id}` : ""}`}
          className="rounded-lg bg-primary px-4 py-2 text-sm text-white"
        >
          {hasVideoAsset ? `View 3 clips (${clipCount}/3)` : t("campaign.detail.taskProgress")}
        </Link>
        {creative && !hasVideoAsset && (
          <Link
            href={`/w/${slug}/creatives/${creative.id}`}
            className="rounded-lg border px-4 py-2 text-sm"
          >
            {t("campaign.detail.viewCreative")}
          </Link>
        )}
        <RunCeoButton campaignId={id} slug={slug} taskStatus={taskStatus} primary />
        {canDelete && (
          <button
            type="button"
            disabled={deleting}
            onClick={deleteCampaign}
            className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
          >
            {deleting ? t("campaigns.deleting") : t("campaigns.delete")}
          </button>
        )}
      </div>

      {deleteError && (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {deleteError}
        </p>
      )}
    </AppShell>
  );
}
