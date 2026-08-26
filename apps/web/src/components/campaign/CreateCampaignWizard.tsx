"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CAMPAIGN_OBJECTIVE_IDS,
  CAMPAIGN_OBJECTIVE_LABELS,
  CreateCampaignContextSchema,
  PUBLISHING_PLATFORM_IDS,
  campaignObjectiveText,
  canonicalizePublishingPlatforms,
  type CampaignObjectiveId,
  type PublishingPlatformId,
} from "@ceo-agent/shared";
import { useI18n } from "@/lib/i18n/provider";
import { CampaignBriefAssistant, TargetAudienceSuggestion } from "./CreateCampaignAssistants";
import { CreateCampaignAssetSelector } from "./CreateCampaignAssetSelector";

const STEPS = ["Campaign Name", "Campaign Context", "Assets", "Campaign Brief", "Review & Create"] as const;
type Step = 0 | 1 | 2 | 3 | 4;
type Draft = {
  idempotencyKey: string;
  name: string;
  objective: CampaignObjectiveId;
  customObjective: string;
  publishingPlatforms: PublishingPlatformId[];
  audienceSummary: string;
  demographics: string;
  interests: string;
  needs: string;
  locations: string;
  audienceNotes: string;
  assetReferences: string[];
  assetStoryReferences: string[];
  campaignBrief: string;
};

function newDraft(): Draft {
  return {
    idempotencyKey: crypto.randomUUID(), name: "", objective: "awareness",
    customObjective: "", publishingPlatforms: [], audienceSummary: "",
    demographics: "", interests: "", needs: "", locations: "", audienceNotes: "",
    assetReferences: [], assetStoryReferences: [], campaignBrief: "",
  };
}

function splitList(value: string): string[] {
  return [...new Set(value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean))];
}

function platformLabel(id: PublishingPlatformId): string {
  if (id === "googleBusiness") return "Google Business";
  if (id === "xiaohongshu") return "Xiaohongshu";
  return id[0]!.toUpperCase() + id.slice(1);
}

export function CreateCampaignWizard({ workspaceSlug }: { workspaceSlug: string }) {
  const router = useRouter();
  const { locale } = useI18n();
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(() => newDraft());
  const [step, setStep] = useState<Step>(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const storageKey = `create-campaign-wave3:${workspaceSlug}`;
  const language: "en" | "zh" | "ms" = locale === "zh" || locale === "ms" ? locale : "en";

  const set = useCallback(<K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setError("");
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function initialize() {
      try {
        const saved = sessionStorage.getItem(storageKey);
        if (saved) {
          const restored = JSON.parse(saved) as { draft?: Draft; step?: number };
          if (restored.draft?.idempotencyKey) setDraft(restored.draft);
          if (Number.isInteger(restored.step) && restored.step! >= 0 && restored.step! <= 4) setStep(restored.step as Step);
        }
        const meResponse = await fetch("/api/me");
        const me = await meResponse.json();
        const workspace = me.workspaces?.find((item: { slug: string }) => item.slug === workspaceSlug);
        if (!workspace) throw new Error("Workspace not found");
        if (cancelled) return;
        setWorkspaceId(workspace.id);
        if (!saved) {
          const profileResponse = await fetch(`/api/workspaces/${workspace.id}/business-profile`);
          const profileBody = await profileResponse.json();
          if (profileResponse.ok) {
            const defaults = canonicalizePublishingPlatforms(profileBody.profile?.defaultPublishingPlatforms ?? []);
            setDraft((current) => ({ ...current, publishingPlatforms: defaults }));
          }
        }
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Unable to initialize Campaign");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void initialize();
    return () => { cancelled = true; };
  }, [storageKey, workspaceSlug]);

  useEffect(() => {
    if (!loading) sessionStorage.setItem(storageKey, JSON.stringify({ draft, step }));
  }, [draft, loading, step, storageKey]);

  useEffect(() => { headingRef.current?.focus(); }, [step]);

  useEffect(() => {
    const onPopState = () => setStep((current) => current > 0 ? (current - 1) as Step : current);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const objectiveText = campaignObjectiveText({ objective: draft.objective, customObjective: draft.customObjective });
  const audience = useMemo(() => ({
    summary: draft.audienceSummary.trim(), demographics: splitList(draft.demographics),
    interests: splitList(draft.interests), needs: splitList(draft.needs),
    locations: splitList(draft.locations),
    ...(draft.audienceNotes.trim() ? { notes: draft.audienceNotes.trim() } : {}),
  }), [draft]);

  function validateStep(index: Step): string | null {
    if (index === 0 && !draft.name.trim()) return "Campaign Name is required";
    if (index === 1) {
      if (draft.objective === "other" && !draft.customObjective.trim()) return "Custom Objective is required";
      if (draft.publishingPlatforms.length === 0) return "Select at least one Publishing Platform";
      if (!draft.audienceSummary.trim()) return "Target Audience is required";
    }
    if (index === 2 && draft.assetReferences.length + draft.assetStoryReferences.length === 0) return "Select at least one Asset or Asset Story";
    return null;
  }

  function next() {
    const validation = validateStep(step);
    if (validation) return setError(validation);
    history.pushState({ createCampaignStep: step + 1 }, "");
    setStep(Math.min(4, step + 1) as Step);
  }

  async function create() {
    if (!workspaceId || submitting) return;
    for (const index of [0, 1, 2] as Step[]) {
      const validation = validateStep(index);
      if (validation) { setStep(index); setError(validation); return; }
    }
    const context = {
      idempotencyKey: draft.idempotencyKey, workspaceId, name: draft.name,
      objective: draft.objective, customObjective: draft.customObjective || undefined,
      publishingPlatforms: draft.publishingPlatforms, targetAudience: audience,
      assetReferences: draft.assetReferences, assetStoryReferences: draft.assetStoryReferences,
      campaignBrief: draft.campaignBrief || undefined, inferredLanguage: language,
    };
    const parsed = CreateCampaignContextSchema.safeParse(context);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Campaign context is invalid");
    setSubmitting(true); setError("");
    try {
      const response = await fetch("/api/campaigns/create", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": draft.idempotencyKey },
        body: JSON.stringify(parsed.data),
      });
      const body = await response.json();
      if (!response.ok || !body.campaignId || !body.taskId) throw new Error(body.error ?? "Campaign creation failed");
      sessionStorage.removeItem(storageKey);
      router.push(`/w/${workspaceSlug}/campaigns/${body.campaignId}/task?taskId=${body.taskId}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Campaign creation failed. You can safely retry.");
    } finally { setSubmitting(false); }
  }

  if (loading) return <p className="p-6 text-sm text-ink-secondary">Loading Create Campaign…</p>;

  return (
    <main className="mx-auto max-w-4xl pb-24" aria-label="Create Campaign Wizard">
      <header className="mb-6 border-b border-border pb-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-ink-secondary">Create Campaign</p>
        <h1 ref={headingRef} tabIndex={-1} className="mt-1 text-2xl font-bold text-navy outline-none">{STEPS[step]}</h1>
        <p className="mt-2 text-sm text-ink-secondary">Step {step + 1} of {STEPS.length}</p>
      </header>
      <ol aria-label="Campaign creation progress" className="mb-6 grid grid-cols-5 gap-1">
        {STEPS.map((label, index) => <li key={label} aria-current={index === step ? "step" : undefined} className={`rounded-lg px-2 py-2 text-center text-[10px] font-semibold sm:text-xs ${index === step ? "bg-navy text-white" : index < step ? "bg-emerald-50 text-emerald-800" : "bg-surface-muted text-ink-secondary"}`}><span className="sm:hidden">{index + 1}</span><span className="hidden sm:inline">{label}</span></li>)}
      </ol>
      <section className="brand-card p-5 sm:p-7">
        {step === 0 ? <label className="block text-sm font-semibold text-navy">Campaign Name<input autoFocus value={draft.name} onChange={(event) => set("name", event.target.value)} maxLength={200} className="mt-2 w-full rounded-xl border border-border px-4 py-3 font-normal" placeholder="e.g. Summer Product Launch" /></label> : null}
        {step === 1 ? <CampaignContextStep draft={draft} set={set} workspaceId={workspaceId} language={language} objectiveText={objectiveText} /> : null}
        {step === 2 && workspaceId ? <CreateCampaignAssetSelector workspaceId={workspaceId} selectedAssetIds={draft.assetReferences} selectedStoryIds={draft.assetStoryReferences} onAssetsChange={(value) => set("assetReferences", value)} onStoriesChange={(value) => set("assetStoryReferences", value)} disabled={submitting} /> : null}
        {step === 3 ? <div><label className="block text-sm font-semibold text-navy">Campaign Brief <span className="font-normal text-ink-secondary">(optional)</span><textarea value={draft.campaignBrief} onChange={(event) => set("campaignBrief", event.target.value)} rows={8} maxLength={10000} className="mt-2 w-full rounded-xl border border-border px-4 py-3 font-normal" placeholder="Describe the marketing intent and content direction." /></label>{workspaceId ? <CampaignBriefAssistant workspaceId={workspaceId} value={draft.campaignBrief} context={{ campaignName: draft.name, objective: objectiveText, platforms: draft.publishingPlatforms, targetAudience: draft.audienceSummary, language }} onAccept={(value) => set("campaignBrief", value)} /> : null}</div> : null}
        {step === 4 ? <dl className="space-y-4"><Review label="Campaign Name" value={draft.name} /><Review label="Objective" value={objectiveText} /><Review label="Publishing Platforms" value={draft.publishingPlatforms.map(platformLabel).join(", ")} /><Review label="Target Audience" value={draft.audienceSummary} /><Review label="Assets" value={`${draft.assetReferences.length} direct assets; ${draft.assetStoryReferences.length} Asset Stories`} /><Review label="Campaign Brief" value={draft.campaignBrief || "Not provided"} /><Review label="Inferred Language" value={`${language.toUpperCase()} (read-only)`} /></dl> : null}
        {error ? <p role="alert" aria-live="assertive" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
        <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
          <button type="button" disabled={step === 0 || submitting} onClick={() => { setError(""); setStep(Math.max(0, step - 1) as Step); }} className="rounded-xl border border-border px-5 py-3 text-sm font-semibold disabled:opacity-40">Back</button>
          {step < 4 ? <button type="button" onClick={next} className="rounded-xl bg-navy px-6 py-3 text-sm font-semibold text-white">Continue</button> : <button type="button" disabled={submitting} onClick={() => void create()} className="rounded-xl bg-navy px-6 py-3 text-sm font-semibold text-white disabled:opacity-50">{submitting ? "Creating and starting workflow…" : "Create Campaign"}</button>}
        </div>
      </section>
    </main>
  );
}

function CampaignContextStep({ draft, set, workspaceId, language, objectiveText }: { draft: Draft; set: <K extends keyof Draft>(key: K, value: Draft[K]) => void; workspaceId: string | null; language: "en" | "zh" | "ms"; objectiveText: string }) {
  return <div className="space-y-6">
    <fieldset><legend className="text-sm font-semibold text-navy">Objective</legend><div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{CAMPAIGN_OBJECTIVE_IDS.map((id) => <label key={id} className="flex items-center gap-2 rounded-xl border border-border p-3 text-sm"><input type="radio" name="objective" checked={draft.objective === id} onChange={() => set("objective", id)} />{CAMPAIGN_OBJECTIVE_LABELS[id]}</label>)}</div></fieldset>
    {draft.objective === "other" ? <label className="block text-sm font-semibold text-navy">Custom Objective<input value={draft.customObjective} onChange={(event) => set("customObjective", event.target.value)} className="mt-2 w-full rounded-xl border border-border px-4 py-3 font-normal" /></label> : null}
    <fieldset><legend className="text-sm font-semibold text-navy">Publishing Platforms</legend><p className="mt-1 text-xs text-ink-secondary">Initialized from Business Profile defaults. Changes apply to this Campaign only.</p><div className="mt-2 flex flex-wrap gap-2">{PUBLISHING_PLATFORM_IDS.map((id) => { const active = draft.publishingPlatforms.includes(id); return <button key={id} type="button" aria-pressed={active} onClick={() => set("publishingPlatforms", active ? draft.publishingPlatforms.filter((value) => value !== id) : canonicalizePublishingPlatforms([...draft.publishingPlatforms, id]))} className={`rounded-lg border px-3 py-2 text-sm font-semibold ${active ? "border-navy bg-navy text-white" : "border-border bg-white text-navy"}`}>{platformLabel(id)}</button>; })}</div></fieldset>
    <label className="block text-sm font-semibold text-navy">Target Audience<textarea value={draft.audienceSummary} onChange={(event) => set("audienceSummary", event.target.value)} rows={4} className="mt-2 w-full rounded-xl border border-border px-4 py-3 font-normal" placeholder="Who should this Campaign reach, and why?" /></label>
    {workspaceId ? <TargetAudienceSuggestion workspaceId={workspaceId} value={draft.audienceSummary} objective={objectiveText} platforms={draft.publishingPlatforms} campaignBrief={draft.campaignBrief} language={language} onAccept={(value) => set("audienceSummary", value)} /> : null}
    <details className="rounded-xl border border-border p-4"><summary className="cursor-pointer text-sm font-semibold text-navy">Structured audience details (optional)</summary><div className="mt-3 grid gap-3 sm:grid-cols-2">{([["demographics", "Demographics"], ["interests", "Interests"], ["needs", "Intent / needs"], ["locations", "Locations"]] as const).map(([key, label]) => <label key={key} className="text-xs font-semibold text-navy">{label}<textarea value={draft[key]} onChange={(event) => set(key, event.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-border p-2 font-normal" placeholder="Comma or line separated" /></label>)}</div></details>
  </div>;
}

function Review({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-border bg-surface-muted/40 p-4"><dt className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">{label}</dt><dd className="mt-1 whitespace-pre-wrap text-sm text-navy">{value}</dd></div>;
}
