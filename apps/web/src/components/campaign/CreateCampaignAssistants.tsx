"use client";

import { useState } from "react";
import type { CampaignBriefAssistAction } from "@ceo-agent/shared";

export function TargetAudienceSuggestion({
  workspaceId,
  value,
  objective,
  platforms,
  campaignBrief,
  language,
  onAccept,
  disabled,
}: {
  workspaceId: string;
  value: string;
  objective: string;
  platforms: string[];
  campaignBrief: string;
  language: "en" | "zh" | "ms";
  onAccept: (value: string) => void;
  disabled?: boolean;
}) {
  const [proposal, setProposal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function suggest() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/audience/suggest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          objective,
          platforms,
          campaignBrief: campaignBrief || undefined,
          currentAudience: value || undefined,
          workspaceLanguage: language,
        }),
      });
      const body = await response.json();
      if (!response.ok || typeof body.text !== "string") throw new Error(body.error ?? "Suggestion failed");
      setProposal(body.text);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Suggestion failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 space-y-2">
      <button type="button" disabled={disabled || busy} onClick={() => void suggest()} className="rounded-lg border border-border px-3 py-2 text-xs font-semibold disabled:opacity-50">
        {busy ? "Suggesting…" : proposal ? "Regenerate suggestion" : "Suggest with AI"}
      </button>
      {proposal ? (
        <div className="rounded-xl border border-brand-blue/20 bg-brand-blue/5 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">Suggestion preview</p>
          <textarea aria-label="Target Audience suggestion preview" value={proposal} onChange={(event) => setProposal(event.target.value)} rows={4} className="mt-2 w-full rounded-lg border border-border bg-white p-3 text-sm" />
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => { onAccept(proposal); setProposal(null); }} className="rounded-lg bg-navy px-3 py-2 text-xs font-semibold text-white">Accept</button>
            <button type="button" onClick={() => setProposal(null)} className="rounded-lg border border-border px-3 py-2 text-xs font-semibold">Discard</button>
          </div>
        </div>
      ) : null}
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
    </div>
  );
}
export function CampaignBriefAssistant({
  workspaceId,
  value,
  context,
  onAccept,
  disabled,
}: {
  workspaceId: string;
  value: string;
  context: { campaignName: string; objective: string; platforms: string[]; targetAudience: string; language: "en" | "zh" | "ms" };
  onAccept: (value: string) => void;
  disabled?: boolean;
}) {
  const [proposal, setProposal] = useState<string | null>(null);
  const [restore, setRestore] = useState<string | null>(null);
  const [busy, setBusy] = useState<CampaignBriefAssistAction | null>(null);
  const [error, setError] = useState("");

  async function assist(action: CampaignBriefAssistAction) {
    if (!value.trim()) return;
    setBusy(action);
    setError("");
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/campaign-brief/assist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, text: value, ...context, workspaceLanguage: context.language }),
      });
      const body = await response.json();
      if (!response.ok || typeof body.text !== "string") throw new Error(body.error ?? "Brief assistance failed");
      setRestore(value);
      setProposal(body.text);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Brief assistance failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap gap-2">
        {(["polish", "expand", "shorten"] as CampaignBriefAssistAction[]).map((action) => (
          <button key={action} type="button" disabled={disabled || Boolean(busy) || !value.trim()} onClick={() => void assist(action)} className="rounded-lg border border-border px-3 py-2 text-xs font-semibold capitalize disabled:opacity-50">
            {busy === action ? "Working…" : action}
          </button>
        ))}
        <button type="button" disabled={disabled || restore == null} onClick={() => { if (restore != null) onAccept(restore); setProposal(null); setRestore(null); }} className="rounded-lg border border-border px-3 py-2 text-xs font-semibold disabled:opacity-50">Restore</button>
      </div>
      {proposal ? (
        <div className="rounded-xl border border-brand-blue/20 bg-brand-blue/5 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">Brief proposal preview</p>
          <textarea aria-label="Campaign Brief proposal preview" value={proposal} onChange={(event) => setProposal(event.target.value)} rows={5} className="mt-2 w-full rounded-lg border border-border bg-white p-3 text-sm" />
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => { onAccept(proposal); setProposal(null); }} className="rounded-lg bg-navy px-3 py-2 text-xs font-semibold text-white">Accept</button>
            <button type="button" onClick={() => setProposal(null)} className="rounded-lg border border-border px-3 py-2 text-xs font-semibold">Discard</button>
          </div>
        </div>
      ) : null}
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
    </div>
  );
}
