"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  normalizeStrategyPlan,
  type MarketingContentPackage,
  type StrategyPlan,
} from "@ceo-agent/shared";
import { MarketingPackagePanel } from "@/components/pipeline/MarketingPackagePanel";
import { useI18n } from "@/lib/i18n/provider";

type TaskRecord = {
  id: string;
  status: string;
  stepProgress?: Record<
    string,
    { status?: string; output?: unknown; error?: string }
  >;
};

export function CampaignMarketingPackageView({
  campaignId,
  slug,
}: {
  campaignId: string;
  slug: string;
}) {
  const { t } = useI18n();
  const [task, setTask] = useState<TaskRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/campaigns/${campaignId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load campaign");
      setTask((data.task as TaskRecord | null) ?? null);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => {
    void load();
    const interval = setInterval(() => void load(), 4000);
    return () => clearInterval(interval);
  }, [load]);

  const progress = task?.stepProgress ?? {};
  const contentPackage =
    progress.content_generate?.status === "completed"
      ? (progress.content_generate.output as MarketingContentPackage | undefined)
      : undefined;
  const strategyPlan: StrategyPlan | undefined =
    progress.strategy_plan?.status === "completed" && progress.strategy_plan.output
      ? normalizeStrategyPlan(progress.strategy_plan.output)
      : undefined;
  const marketingScore =
    progress.marketing_score?.status === "completed"
      ? (progress.marketing_score.output as Record<string, unknown> | undefined)
      : undefined;

  const active =
    task &&
    (task.status === "queued" ||
      task.status === "running" ||
      task.status === "retrying" ||
      task.status === "resume");

  if (loading) {
    return <p className="text-sm text-ink-secondary">{t("campaign.workspace.loading")}</p>;
  }

  if (error) {
    return <p className="text-sm text-red-600">{error}</p>;
  }

  if (!task) {
    return (
      <div className="rounded-2xl border border-border bg-white p-6 text-center">
        <p className="text-sm text-ink-secondary">
          Generate to run the production Marketing pipeline and populate this package.
        </p>
      </div>
    );
  }

  if (active && !contentPackage) {
    return (
      <div className="space-y-4 rounded-2xl border border-border bg-white p-6">
        <p className="text-sm text-navy">
          Marketing pipeline running — status: <strong>{task.status}</strong>
        </p>
        <Link
          href={`/w/${slug}/campaigns/${campaignId}/task?taskId=${task.id}`}
          className="inline-flex rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white"
        >
          View progress
        </Link>
      </div>
    );
  }

  if (!contentPackage) {
    return (
      <div className="space-y-3 rounded-2xl border border-border bg-white p-6">
        <p className="text-sm text-ink-secondary">
          Marketing content is not ready yet. Open the task view to retry or inspect errors.
        </p>
        <Link
          href={`/w/${slug}/campaigns/${campaignId}/task?taskId=${task.id}`}
          className="text-sm font-semibold text-brand-blue hover:underline"
        >
          Open task
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-secondary">
          Production marketing output from task {task.id.slice(0, 8)}…
        </p>
        <Link
          href={`/w/${slug}/campaigns/${campaignId}/task?taskId=${task.id}`}
          className="text-sm font-semibold text-brand-blue hover:underline"
        >
          Review & export
        </Link>
      </div>
      <MarketingPackagePanel
        contentPackage={contentPackage}
        taskId={task.id}
        strategy={strategyPlan}
      />
      {marketingScore ? (
        <details className="rounded-xl border border-border bg-white p-4 text-sm">
          <summary className="cursor-pointer font-semibold text-navy">Marketing score</summary>
          <pre className="mt-2 overflow-auto text-xs text-ink-secondary">
            {JSON.stringify(marketingScore, null, 2)}
          </pre>
        </details>
      ) : null}
    </div>
  );
}
