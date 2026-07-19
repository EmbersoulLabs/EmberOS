"use client";

import { useI18n } from "@/lib/i18n/provider";
import type { TranslationKey } from "@ceo-agent/shared/i18n";
import type { CampaignWorkspaceData } from "./CampaignWorkspaceShell";

const TIMELINE_STEPS = [
  "analyze",
  "strategy",
  "copy",
  "video",
  "package",
] as const;

interface Props {
  data: CampaignWorkspaceData;
}

export function CampaignWorkspaceActivity({ data }: Props) {
  const { t } = useI18n();
  const task = data.task;
  const stepProgress = (task?.stepProgress as Record<string, { status?: string }>) ?? {};

  const events: Array<{ label: string; at?: string }> = [];
  const campaign = data.campaign;
  if (campaign.createdAt) {
    events.push({
      label: t("campaign.workspace.activity.created"),
      at: campaign.createdAt as string,
    });
  }
  if (campaign.firstGeneratedAt) {
    events.push({
      label: t("campaign.workspace.activity.firstGenerate"),
      at: campaign.firstGeneratedAt as string,
    });
  }
  if (campaign.lastGeneratedAt) {
    events.push({
      label: t("campaign.workspace.activity.lastGenerate"),
      at: campaign.lastGeneratedAt as string,
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="rounded-xl border border-border/80 bg-surface p-5 shadow-card">
        <h2 className="text-sm font-semibold text-navy">{t("campaign.workspace.activity.timeline")}</h2>
        {events.length === 0 ? (
          <p className="mt-4 text-sm text-ink-secondary">{t("campaign.workspace.empty.noActivity")}</p>
        ) : (
          <ol className="mt-4 space-y-3">
            {events.map((e, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-blue" />
                <div>
                  <p className="font-medium text-navy">{e.label}</p>
                  {e.at && (
                    <p className="text-xs text-ink-secondary">
                      {new Date(e.at).toLocaleString()}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="rounded-xl border border-border/80 bg-surface p-5 shadow-card">
        <h2 className="text-sm font-semibold text-navy">{t("campaign.workspace.progress.title")}</h2>
        <ul className="mt-4 space-y-3">
          {TIMELINE_STEPS.map((step) => {
            const status = stepProgress[step]?.status ?? "pending";
            return (
              <li key={step} className="flex items-center justify-between text-sm">
                <span className="text-navy">
                  {t(`campaign.workspace.progress.steps.${step}` as TranslationKey)}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    status === "completed"
                      ? "bg-emerald-50 text-emerald-700"
                      : status === "running"
                        ? "bg-blue-50 text-blue-700"
                        : status === "failed"
                          ? "bg-red-50 text-red-700"
                          : "bg-surface-muted text-ink-secondary"
                  }`}
                >
                  {t(`campaign.workspace.progress.status.${status}` as TranslationKey)}
                </span>
              </li>
            );
          })}
        </ul>
        {data.aiGenerationState === "failed" && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <p>{t("campaign.workspace.failure.message")}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" disabled className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white opacity-60">
                {t("campaign.workspace.failure.retryAll")}
              </button>
              <button type="button" className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700">
                {t("campaign.workspace.failure.cancel")}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
