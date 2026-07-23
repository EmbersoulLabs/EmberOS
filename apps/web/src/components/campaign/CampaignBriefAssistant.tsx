"use client";

import { useState } from "react";
import type { CampaignBriefAssistAction } from "@ceo-agent/shared";
import { useI18n } from "@/lib/i18n/provider";

/**
 * PD-041 Campaign Brief AI Writing Assistant.
 * Exactly three actions, one proposal, explicit Accept, one restore snapshot.
 */
export function CampaignBriefAssistant({
  campaignId,
  value,
  onChange,
  campaignName,
  objectiveLabel,
  disabled,
}: {
  campaignId: string | null;
  value: string;
  onChange: (next: string) => void;
  campaignName?: string;
  objectiveLabel?: string;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const [restoreSnapshot, setRestoreSnapshot] = useState<string | null>(null);
  const [proposal, setProposal] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<CampaignBriefAssistAction | null>(null);
  const [error, setError] = useState("");
  const [lastFailedAction, setLastFailedAction] = useState<CampaignBriefAssistAction | null>(
    null
  );

  const empty = !value.trim();
  const assisting = busyAction != null;
  const hasProposal = proposal != null;

  async function runAction(action: CampaignBriefAssistAction) {
    if (!campaignId || empty || assisting || disabled) return;
    setError("");
    setLastFailedAction(null);
    setBusyAction(action);
    // Snapshot is the accepted brief immediately before this AI action.
    const previous = value;
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/brief/assist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          text: value,
          campaignName,
          objective: objectiveLabel,
        }),
      });
      const data = await res.json();
      if (!res.ok || typeof data.text !== "string") {
        throw new Error(data.error ?? t("campaign.briefAssist.failed"));
      }
      // Do not auto-accept — keep active Brief unchanged until Accept.
      setRestoreSnapshot(previous);
      setProposal(data.text);
    } catch (err) {
      setLastFailedAction(action);
      setError(err instanceof Error ? err.message : t("campaign.briefAssist.failed"));
      // Failure preserves existing Brief and any prior proposal state intentionally.
    } finally {
      setBusyAction(null);
    }
  }

  function acceptProposal() {
    if (proposal == null) return;
    onChange(proposal);
    setProposal(null);
    setError("");
  }

  function restore() {
    if (restoreSnapshot == null) return;
    onChange(restoreSnapshot);
    setRestoreSnapshot(null);
    setProposal(null);
    setError("");
  }

  const actions: Array<{ id: CampaignBriefAssistAction; label: string }> = [
    { id: "polish", label: t("campaign.briefAssist.polish") },
    { id: "expand", label: t("campaign.briefAssist.expand") },
    { id: "shorten", label: t("campaign.briefAssist.shorten") },
  ];

  return (
    <div className="space-y-3">
      <label className="block text-sm font-semibold text-navy">
        {t("campaign.workspace.briefOptional")}
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={5}
          disabled={disabled || assisting}
          className="mt-1.5 w-full rounded-xl border border-border px-4 py-2.5 text-sm font-normal disabled:opacity-60"
          placeholder={t("campaign.workspace.briefPlaceholder")}
        />
      </label>

      <div className="flex flex-wrap gap-2">
        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            disabled={disabled || empty || assisting || !campaignId}
            onClick={() => void runAction(action.id)}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-navy disabled:opacity-50"
          >
            {busyAction === action.id ? t("campaign.briefAssist.working") : action.label}
          </button>
        ))}
        <button
          type="button"
          disabled={disabled || restoreSnapshot == null || assisting}
          onClick={restore}
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-ink-secondary disabled:opacity-50"
        >
          {t("campaign.briefAssist.restore")}
        </button>
      </div>

      {hasProposal ? (
        <div className="rounded-xl border border-border bg-surface-muted/50 p-3 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
            {t("campaign.briefAssist.proposal")}
          </p>
          <textarea
            value={proposal}
            onChange={(e) => setProposal(e.target.value)}
            rows={4}
            disabled={disabled || assisting}
            className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm disabled:opacity-60"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={disabled || assisting || !proposal.trim()}
              onClick={acceptProposal}
              className="rounded-lg bg-navy px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              {t("campaign.briefAssist.accept")}
            </button>
            <button
              type="button"
              disabled={disabled || assisting}
              onClick={() => setProposal(null)}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-ink-secondary"
            >
              {t("campaign.briefAssist.discardProposal")}
            </button>
          </div>
        </div>
      ) : null}

      {!campaignId ? (
        <p className="text-xs text-ink-secondary">{t("campaign.briefAssist.needDraft")}</p>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <p>{error}</p>
          {lastFailedAction ? (
            <button
              type="button"
              className="mt-2 text-xs font-semibold underline"
              disabled={assisting || empty}
              onClick={() => void runAction(lastFailedAction)}
            >
              {t("campaign.briefAssist.retry")}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
