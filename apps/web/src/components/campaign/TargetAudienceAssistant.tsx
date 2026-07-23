"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/provider";

/**
 * PD-043 Target Audience — AI Suggest with explicit Accept / Edit / Regenerate.
 * Only Accept writes into the Target Audience field.
 */
export function TargetAudienceAssistant({
  workspaceId,
  value,
  onChange,
  objectiveLabel,
  platforms,
  description,
  disabled,
}: {
  workspaceId: string | null;
  value: string;
  onChange: (next: string) => void;
  objectiveLabel?: string;
  platforms: string[];
  description?: string;
  disabled?: boolean;
}) {
  const { t, locale } = useI18n();
  const [proposal, setProposal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const hasProposal = proposal != null;

  async function suggest() {
    if (!workspaceId || busy || disabled) return;
    setError("");
    setBusy(true);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/audience/suggest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          objective: objectiveLabel || undefined,
          platforms,
          description: description?.trim() || undefined,
          currentAudience: proposal?.trim() || value.trim() || undefined,
          workspaceLanguage: locale,
        }),
      });
      const data = await res.json();
      if (!res.ok || typeof data.text !== "string") {
        throw new Error(data.error ?? t("campaign.audienceAssist.failed"));
      }
      setProposal(data.text);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("campaign.audienceAssist.failed"));
    } finally {
      setBusy(false);
    }
  }

  function acceptProposal() {
    if (proposal == null) return;
    onChange(proposal);
    setProposal(null);
    setError("");
  }

  return (
    <div className="space-y-3">
      <label className="block text-sm font-semibold text-navy">
        {t("campaign.workspace.targetAudience")}
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          disabled={disabled || busy}
          className="mt-1.5 w-full rounded-xl border border-border px-4 py-2.5 text-sm font-normal disabled:opacity-60"
          placeholder={t("campaign.workspace.targetAudiencePlaceholder")}
        />
      </label>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled || busy || !workspaceId}
          onClick={() => void suggest()}
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-navy disabled:opacity-50"
        >
          {busy
            ? t("campaign.audienceAssist.working")
            : hasProposal
              ? t("campaign.audienceAssist.regenerate")
              : t("campaign.audienceAssist.suggest")}
        </button>
      </div>

      {hasProposal ? (
        <div className="space-y-2 rounded-xl border border-border bg-surface-muted/50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
            {t("campaign.audienceAssist.proposal")}
          </p>
          <textarea
            value={proposal}
            onChange={(e) => setProposal(e.target.value)}
            rows={3}
            disabled={disabled || busy}
            className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm disabled:opacity-60"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={disabled || busy || !proposal.trim()}
              onClick={acceptProposal}
              className="rounded-lg bg-navy px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              {t("campaign.audienceAssist.accept")}
            </button>
            <button
              type="button"
              disabled={disabled || busy}
              onClick={() => setProposal(null)}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-ink-secondary"
            >
              {t("campaign.audienceAssist.discard")}
            </button>
          </div>
        </div>
      ) : null}

      {!workspaceId ? (
        <p className="text-xs text-ink-secondary">{t("campaign.audienceAssist.needWorkspace")}</p>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <p>{error}</p>
          <button
            type="button"
            className="mt-2 text-xs font-semibold underline"
            disabled={busy}
            onClick={() => void suggest()}
          >
            {t("campaign.audienceAssist.retry")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
