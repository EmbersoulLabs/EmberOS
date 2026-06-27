"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/provider";
import { getRenderPreferencesPayload, resolveContentLocaleForRun } from "@/lib/preferences";

function isTaskActive(status?: string | null): boolean {
  return status === "queued" || status === "running";
}

export function RunCeoButton({
  campaignId,
  slug,
  taskStatus,
  primary = false,
  className = "",
}: {
  campaignId: string;
  slug: string;
  taskStatus?: string | null;
  primary?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const { t, locale } = useI18n();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  if (isTaskActive(taskStatus)) return null;

  const isRerun = taskStatus === "completed" || taskStatus === "failed";
  const label = running
    ? t("campaign.detail.running")
    : isRerun
      ? t("campaign.detail.rerun")
      : t("campaign.detail.run");

  async function handleRun() {
    setError("");
    setRunning(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locale: resolveContentLocaleForRun(locale),
          ...getRenderPreferencesPayload(),
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? t("error.runCampaign"));
        return;
      }
      if (body.taskId) {
        router.push(`/w/${slug}/campaigns/${campaignId}/task?taskId=${body.taskId}`);
        return;
      }
      router.refresh();
    } catch {
      setError(t("error.runCampaign"));
    } finally {
      setRunning(false);
    }
  }

  const baseClass = primary
    ? "rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-60"
    : "rounded-lg border border-primary px-4 py-2 text-sm font-medium text-primary hover:bg-primary/5 disabled:opacity-60";

  return (
    <div className={className}>
      <button type="button" disabled={running} onClick={handleRun} className={baseClass}>
        {label}
      </button>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
