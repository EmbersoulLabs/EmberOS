"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AppShell, StatusBadge } from "@/components/AppShell";
import { StoryRuntimePanel } from "@/components/ai-story/StoryRuntimePanel";
import { PlanningApprovalControl } from "@/components/ai-story/PlanningApprovalControl";
import { CharacterPanel } from "@/components/ai-story/CharacterPanel";
import { SupportingCastPanel } from "@/components/ai-story/SupportingCastPanel";
import { ExecutionPlanReviewPanel } from "@/components/ai-story-review/ExecutionPlanReviewPanel";
import { executionPlanStorageKey } from "@/lib/ai-story-review-assembly-ui";
import { fetchCurrentExecutionPlan } from "@/lib/ai-story-execution-plan-discovery-client";
import {
  STORY_PLANNING_STAGE_ORDER,
  type AnimationPackagePayload,
  type AiStoryCharacterAuthorityVersion,
  type AiStorySupportingCharacterVersion,
  type AiStoryStructuredDraft,
  type CreativeContext,
  type StoryPlanningDraft,
  type StoryPlanningStage,
  type WorkspaceRole,
} from "@ceo-agent/shared";

const EMPTY_DRAFT: AiStoryStructuredDraft = {
  title: "", summary: "", objective: "", targetAudience: "", tone: "",
  estimatedDuration: "", story: { opening: "", development: "", ending: "" },
  keyMessages: [], cta: "", assetReferences: [], warnings: [],
};

const STAGE_LABELS: Record<StoryPlanningStage, string> = {
  creative_context: "Generate Creative Context",
  director_thinking: "Generate Director Thinking",
  story_beats: "Generate Story Beats",
  scene_plan: "Generate Scene Plan",
  shot_plan: "Generate Shot Plan",
  character_continuity: "Generate Character Continuity",
  world_continuity: "Generate World Continuity",
  animation_package: "Assemble Animation Package",
};

type SaveState = "CLEAN" | "DIRTY" | "SAVING" | "SAVED" | "ERROR";

function isReadOnlyStatus(status: string): boolean {
  return ["ready_for_animation", "planning", "planning_review", "ready_for_execution",
    "generate_review", "executing", "execution_review", "execution_failed", "archived"].includes(status);
}

function isPlanningStatus(status: string): boolean {
  return ["ready_for_animation", "planning", "planning_review", "ready_for_execution", "failed"].includes(status);
}

function isAdvancedOperator(role: WorkspaceRole | string | null): boolean {
  return role === "admin" || role === "operator";
}

function normalizeDraft(content: AiStoryStructuredDraft): AiStoryStructuredDraft {
  return {
    ...EMPTY_DRAFT, ...content,
    story: { ...EMPTY_DRAFT.story, ...(content.story ?? {}) },
    keyMessages: content.keyMessages ?? [], assetReferences: content.assetReferences ?? [],
    warnings: content.warnings ?? [],
  };
}

export default function AiStoryReviewPage() {
  const params = useParams();
  const slug = params.slug as string;
  const campaignId = params.id as string;
  const storyId = params.storyId as string;
  const [status, setStatus] = useState("draft");
  const [draft, setDraft] = useState<AiStoryStructuredDraft>(EMPTY_DRAFT);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [creativeContext, setCreativeContext] = useState<CreativeContext | null>(null);
  const [animationPackage, setAnimationPackage] = useState<AnimationPackagePayload | null>(null);
  const [planningDraft, setPlanningDraft] = useState<StoryPlanningDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [busyStage, setBusyStage] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("CLEAN");
  const [polishPreview, setPolishPreview] = useState<AiStoryStructuredDraft | null>(null);
  const [workspaceRole, setWorkspaceRole] = useState<WorkspaceRole | string | null>(null);
  const [storyVersionId, setStoryVersionId] = useState<string | null>(null);
  const [animationPackageRecordId, setAnimationPackageRecordId] = useState<string | null>(null);
  const [initialCharacters, setInitialCharacters] = useState<AiStoryCharacterAuthorityVersion[] | undefined>();
  const [initialSupportingCharacters, setInitialSupportingCharacters] = useState<AiStorySupportingCharacterVersion[] | undefined>();
  const persistedDraftFingerprint = useRef("");
  const saveGeneration = useRef(0);
  const advancedAuthorized = isAdvancedOperator(workspaceRole);
  const readOnly = isReadOnlyStatus(status);

  useEffect(() => {
    void (async () => {
      try {
        const meRes = await fetch("/api/me");
        if (!meRes.ok) return;
        const me = await meRes.json();
        const ws = (me.workspaces as Array<{ slug: string; role: string }> | undefined)
          ?.find((workspace) => workspace.slug === slug);
        setWorkspaceRole(ws?.role ?? null);
      } catch { setWorkspaceRole(null); }
    })();
  }, [slug]);

  const load = useCallback(async () => {
    setError(""); setLoading(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/ai-stories/${storyId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load story");
      const nextStatus = String(data.story.status);
      setStatus(nextStatus);
      setInitialCharacters(Array.isArray(data.characters) ? data.characters : undefined);
      setInitialSupportingCharacters(Array.isArray(data.supportingCharacters) ? data.supportingCharacters : undefined);
      setStoryVersionId(typeof data.currentVersion?.id === "string" ? data.currentVersion.id : null);
      const content = data.currentVersion?.structuredContent as AiStoryStructuredDraft | undefined;
      if (content) {
        const normalized = normalizeDraft(content);
        persistedDraftFingerprint.current = JSON.stringify(normalized);
        setDraft(normalized); setWarnings(normalized.warnings); setSaveState("CLEAN");
      }
      if (advancedAuthorized && isPlanningStatus(nextStatus)) {
        const planningRes = await fetch(`/api/campaigns/${campaignId}/ai-stories/${storyId}/planning`);
        if (planningRes.ok) {
          const planningData = await planningRes.json();
          setCreativeContext((planningData.creativeContext?.payload as CreativeContext | undefined) ?? null);
          setPlanningDraft((planningData.planningDraft as StoryPlanningDraft | undefined) ?? null);
          setAnimationPackage((planningData.completePackage as AnimationPackagePayload | undefined) ??
            (planningData.animationPackage?.payload && !("kind" in (planningData.animationPackage.payload as object))
              ? (planningData.animationPackage.payload as AnimationPackagePayload) : null));
          setAnimationPackageRecordId(typeof planningData.animationPackage?.id === "string"
            ? planningData.animationPackage.id : null);
        }
      } else {
        setCreativeContext(null); setPlanningDraft(null); setAnimationPackage(null);
        setAnimationPackageRecordId(null);
      }
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to load story");
    } finally {
      setLoading(false);
    }
  }, [advancedAuthorized, campaignId, storyId]);

  useEffect(() => { void load(); }, [load]);

  const persistDraft = useCallback(async (nextDraft: AiStoryStructuredDraft) => {
    const generation = ++saveGeneration.current;
    setSaveState("SAVING");
    const res = await fetch(`/api/campaigns/${campaignId}/ai-stories/${storyId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ structuredContent: nextDraft }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (generation === saveGeneration.current) setSaveState("ERROR");
      throw new Error(data.error ?? "Save failed");
    }
    if (generation === saveGeneration.current) {
      persistedDraftFingerprint.current = JSON.stringify(nextDraft);
      setSaveState("SAVED");
    }
  }, [campaignId, storyId]);

  useEffect(() => {
    if (loading || readOnly || !persistedDraftFingerprint.current) return;
    if (JSON.stringify(draft) === persistedDraftFingerprint.current) return;
    setSaveState("DIRTY");
    const timer = setTimeout(() => {
      void persistDraft(draft).catch((err) => setError(err instanceof Error ? err.message : "Save failed"));
    }, 900);
    return () => clearTimeout(timer);
  }, [draft, loading, persistDraft, readOnly]);

  const completedStages = useMemo(() => new Set(planningDraft?.completedStages ?? []), [planningDraft]);
  function updateDraft(next: AiStoryStructuredDraft) { setDraft(next); setPolishPreview(null); }

  async function approveStoryForAnimation() {
    setBusy(true); setError("");
    try {
      if (JSON.stringify(draft) !== persistedDraftFingerprint.current) await persistDraft(draft);
      const res = await fetch(`/api/campaigns/${campaignId}/ai-stories/${storyId}/approve`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Story approval failed");
      setStatus(data.status ?? "ready_for_animation"); await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Story approval failed"); }
    finally { setBusy(false); }
  }

  async function requestPolishPreview() {
    setBusy(true); setError("");
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/ai-stories/${storyId}/rewrite`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ previewOnly: true, structuredContent: draft }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "AI Polish failed");
      setPolishPreview(normalizeDraft(data.draft as AiStoryStructuredDraft));
    } catch (err) { setError(err instanceof Error ? err.message : "AI Polish failed"); }
    finally { setBusy(false); }
  }

  async function acceptPolishPreview() {
    if (!polishPreview) return;
    setBusy(true); setError("");
    try {
      await persistDraft(polishPreview); setDraft(polishPreview);
      setWarnings(polishPreview.warnings); setPolishPreview(null);
    } catch (err) { setError(err instanceof Error ? err.message : "AI Polish could not be accepted"); }
    finally { setBusy(false); }
  }

  async function generatePlanning() {
    setBusy(true); setError("");
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/ai-stories/${storyId}/planning/generate`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Animation preparation failed");
      setStatus(data.status ?? "planning_review"); await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Animation preparation failed"); }
    finally { setBusy(false); }
  }

  async function runStage(stage: StoryPlanningStage) {
    setBusy(true); setBusyStage(stage); setError("");
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/ai-stories/${storyId}/planning/stages/${stage}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Stage ${stage} failed`);
      setStatus(data.status ?? status); await load();
    } catch (err) { setError(err instanceof Error ? err.message : `Stage ${stage} failed`); }
    finally { setBusy(false); setBusyStage(null); }
  }

  async function runScreenwriter(action: "characters" | "dialogue" | "narrative") {
    setBusy(true); setError("");
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/ai-stories/${storyId}/screenwriter`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Screenwriter ${action} failed`);
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : `Screenwriter ${action} failed`); }
    finally { setBusy(false); }
  }

  function stageEnabled(stage: StoryPlanningStage): boolean {
    const index = STORY_PLANNING_STAGE_ORDER.indexOf(stage);
    if (index === 0) return true;
    const prior = STORY_PLANNING_STAGE_ORDER[index - 1]!;
    return completedStages.has(prior) || Boolean(creativeContext && stage === "director_thinking");
  }

  if (loading) return <AppShell><p className="text-sm text-ink-secondary">Loading story…</p></AppShell>;
  const executionActive = ["ready_for_execution", "generate_review", "executing", "execution_review", "execution_failed"].includes(status);

  return (
    <AppShell>
      <main className="mx-auto max-w-4xl space-y-6" data-testid="ai-story-normal-user-flow">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div><Link href={`/w/${slug}/campaigns/${campaignId}`} className="text-sm text-brand-blue hover:underline">← Campaign</Link><p className="mt-3 text-xs font-semibold uppercase tracking-[0.16em] text-brand-blue">AI Story</p><h1 className="mt-1 text-2xl font-bold text-navy">Your Story</h1></div>
          <StatusBadge status={status} />
        </header>
        <ol className="grid gap-2 text-sm sm:grid-cols-4" aria-label="AI Story progress">
          {["Your Story", "AI Polish", "Story Review", "Generate Animation"].map((label, index) => <li key={label} className="rounded-lg border border-border bg-white px-3 py-2"><span className="mr-2 text-brand-blue">{index + 1}</span>{label}</li>)}
        </ol>
        {["ready_for_animation", "planning", "planning_review"].includes(status) ? <div className="rounded-xl border border-brand-teal/30 bg-brand-teal/5 p-4 text-sm text-brand-teal" data-testid="animation-preparation-status">Your approved Story is being prepared for animation. Directing, scene, shot, and continuity analysis stay internal.</div> : null}
        {status === "ready_for_execution" ? <div className="rounded-xl border border-brand-teal/30 bg-brand-teal/5 p-4 text-sm font-semibold text-brand-teal">Your Story is ready for generation review.</div> : null}
        {warnings.length > 0 ? <ul className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{warnings.map((warning) => <li key={warning}>• {warning}</li>)}</ul> : null}
        {error ? <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p> : null}

        <section className="space-y-4 rounded-2xl border border-border bg-white p-5" aria-labelledby="story-review-heading">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="story-review-heading" className="text-lg font-bold text-navy">Story Review</h2><p className="mt-1 text-sm text-ink-secondary">Review what the audience will experience. Filming and provider details are handled by EmberOS.</p></div>{!readOnly ? <span className="text-xs text-ink-secondary" role="status" data-testid="story-save-state">{saveState === "SAVING" ? "Saving…" : saveState === "ERROR" ? "Save failed" : saveState === "DIRTY" ? "Unsaved changes" : "Saved"}</span> : null}</div>
          <div className="grid gap-4">
            {([['title','Title'],['summary','Summary'],['objective','Objective'],['targetAudience','Target audience'],['tone','Tone'],['estimatedDuration','Estimated duration'],['cta','CTA']] as const).map(([key,label]) => <label key={key} className="block space-y-1"><span className="text-sm font-medium text-navy">{label}</span><input className="w-full rounded-lg border border-border px-3 py-2 text-sm disabled:bg-slate-50" value={draft[key]} disabled={readOnly} onChange={(event) => updateDraft({...draft,[key]:event.target.value})} /></label>)}
            {(['opening','development','ending'] as const).map((part) => <label key={part} className="block space-y-1"><span className="text-sm font-medium capitalize text-navy">{part}</span><textarea className="min-h-[100px] w-full rounded-lg border border-border px-3 py-2 text-sm disabled:bg-slate-50" value={draft.story[part]} disabled={readOnly} onChange={(event) => updateDraft({...draft,story:{...draft.story,[part]:event.target.value}})} /></label>)}
          </div>
          {!readOnly ? <div className="flex flex-wrap gap-3"><button type="button" disabled={busy} onClick={() => void requestPolishPreview()} className="rounded-lg border border-border px-4 py-2 text-sm font-medium">{busy ? "Polishing…" : "AI Polish"}</button><button type="button" disabled={busy || saveState === "SAVING"} onClick={() => void approveStoryForAnimation()} className="brand-btn-primary">Generate Animation</button></div> : null}
        </section>

         <CharacterPanel campaignId={campaignId} canEdit={advancedAuthorized} initialCharacters={initialCharacters} />
         <SupportingCastPanel campaignId={campaignId} storyId={storyId} canEdit={advancedAuthorized} initialSupportingCharacters={initialSupportingCharacters} />

        {polishPreview ? <section className="space-y-4 rounded-2xl border border-brand-blue/30 bg-brand-blue/5 p-5" data-testid="ai-polish-preview"><div><h2 className="text-lg font-bold text-navy">AI Polish Preview</h2><p className="mt-1 text-sm text-ink-secondary">Your current Story remains authoritative until you accept this preview.</p></div><StoryPreview draft={polishPreview} /><div className="flex flex-wrap gap-2"><button type="button" className="brand-btn-primary" disabled={busy} onClick={() => void acceptPolishPreview()}>Accept changes</button><button type="button" className="rounded-lg border border-border bg-white px-3 py-2 text-sm" disabled={busy} onClick={() => setPolishPreview(null)}>Cancel</button><button type="button" className="rounded-lg border border-border bg-white px-3 py-2 text-sm" disabled={busy} onClick={() => void requestPolishPreview()}>Regenerate</button></div></section> : null}

        {isPlanningStatus(status) && !advancedAuthorized ? <section className="rounded-2xl border border-border bg-white p-5" data-testid="internal-planning-hidden"><h2 className="text-lg font-bold text-navy">Animation preparation</h2><p className="mt-1 text-sm text-ink-secondary">EmberOS is handling directing and production planning. An authorized operator will continue when preparation is ready.</p></section> : null}

        {advancedAuthorized && isPlanningStatus(status) ? <details className="rounded-2xl border border-border bg-white p-5" data-testid="advanced-planning-diagnostics"><summary className="cursor-pointer text-sm font-semibold text-navy">Advanced animation preparation</summary><div className="mt-4 space-y-4"><p className="text-sm text-ink-secondary">Authorized operator controls for Plan QC and preparation. These internal planning artifacts are not part of the normal-user workflow.</p>{status !== "planning_review" && status !== "ready_for_execution" ? <button type="button" disabled={busy} onClick={() => void generatePlanning()} className="brand-btn-primary">{busy && !busyStage ? "Preparing…" : "Prepare Animation"}</button> : null}<div className="grid gap-2">{STORY_PLANNING_STAGE_ORDER.map((stage) => { const done=completedStages.has(stage)||(stage==="animation_package"&&Boolean(animationPackage)); const enabled=stageEnabled(stage); return <div key={stage} className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-2 last:border-0"><div><p className="text-sm font-medium text-navy">{STAGE_LABELS[stage]}</p><p className="text-xs text-ink-secondary">{done?"Complete":enabled?"Ready":"Waiting on prior stage"}</p></div><button type="button" disabled={busy||!enabled||status==="ready_for_execution"} onClick={() => void runStage(stage)} className="rounded-lg border border-border px-3 py-1.5 text-sm disabled:opacity-50">{busyStage===stage?"Running…":done?`Regenerate ${STAGE_LABELS[stage].replace(/^Generate |^Assemble /,"")}`:STAGE_LABELS[stage]}</button></div>;})}</div><div className="flex flex-wrap gap-3"><button type="button" disabled={busy||status==="ready_for_execution"} onClick={() => void runScreenwriter("characters")} className="rounded-lg border border-border px-3 py-1.5 text-sm">Generate Characters</button><button type="button" disabled={busy||status==="ready_for_execution"} onClick={() => void runScreenwriter("dialogue")} className="rounded-lg border border-border px-3 py-1.5 text-sm">Generate Dialogue</button><button type="button" disabled={busy||status==="ready_for_execution"} onClick={() => void runScreenwriter("narrative")} className="rounded-lg border border-border px-3 py-1.5 text-sm">Generate Narrative</button></div>{status === "planning_review" ? <PlanningApprovalControl campaignId={campaignId} storyId={storyId} storyVersionId={storyVersionId} animationPackageId={animationPackageRecordId} disabled={busy} onApproved={async (nextStatus) => { setStatus(nextStatus); await load(); }} onError={setError} /> : null}{creativeContext ? <PackageSection title="Creative Context" value={creativeContext} /> : null}{planningDraft ? <PackageSection title="Planning Draft Progress" value={{completedStages:planningDraft.completedStages,beats:planningDraft.storyBeats?.length??0,scenes:planningDraft.scenePlan?.length??0,shots:planningDraft.shotPlan?.length??0}} /> : null}{animationPackage ? <><PackageSection title="Director Thinking" value={animationPackage.directorThinking}/><PackageSection title="Beats" value={animationPackage.storyBeats}/><PackageSection title="Scenes" value={animationPackage.scenePlan}/><PackageSection title="Shots" value={animationPackage.shotPlan}/></> : null}</div></details> : null}
        {executionActive ? <ExecutionPanel campaignId={campaignId} storyId={storyId} status={status} busy={busy} setBusy={setBusy} setError={setError} onDone={load} workspaceRole={workspaceRole} storyTitle={draft.title} storyVersionId={storyVersionId} animationPackageId={animationPackageRecordId} advancedAuthorized={advancedAuthorized} /> : null}
      </main>
    </AppShell>
  );
}

function StoryPreview({ draft }: { draft: AiStoryStructuredDraft }) {
  return <div className="space-y-3 rounded-xl border border-border bg-white p-4 text-sm"><h3 className="font-semibold text-navy">{draft.title}</h3><p>{draft.summary}</p><div><strong>Opening</strong><p>{draft.story.opening}</p></div><div><strong>Development</strong><p>{draft.story.development}</p></div><div><strong>Ending</strong><p>{draft.story.ending}</p></div></div>;
}

function PackageSection({ title, value }: { title: string; value: unknown }) {
  return <div className="rounded-xl border border-border bg-surface-muted p-4"><h3 className="text-sm font-semibold text-navy">{title}</h3><pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap text-xs text-ink-secondary">{JSON.stringify(value,null,2)}</pre></div>;
}

type SafeSceneIntentHint = { sceneExecutionId: string; sceneId?: string; sceneOrder?: number; purpose?: string; plannedDurationMs?: number; shotCount?: number; referencedAssetIds?: string[] };

function ExecutionPanel({ campaignId, storyId, status, busy, setBusy, setError, onDone, workspaceRole, storyTitle, storyVersionId, animationPackageId, advancedAuthorized }: { campaignId:string; storyId:string; status:string; busy:boolean; setBusy:(value:boolean)=>void; setError:(value:string)=>void; onDone:()=>Promise<void>; workspaceRole:WorkspaceRole|string|null; storyTitle:string; storyVersionId:string|null; animationPackageId:string|null; advancedAuthorized:boolean }) {
  const [executionPlanId,setExecutionPlanId]=useState<string|null>(null);
  const [planReady,setPlanReady]=useState(false);
  const [compilationHash,setCompilationHash]=useState<string|null>(null);
  const [sceneIntentHints,setSceneIntentHints]=useState<SafeSceneIntentHint[]>([]);
  useEffect(()=>{let cancelled=false; void (async()=>{try{const data=await fetchCurrentExecutionPlan({ campaignId, storyId }); if(cancelled)return; const discoveredId=typeof data.executionPlan?.executionPlanId==="string"?data.executionPlan.executionPlanId:null; setExecutionPlanId(discoveredId); setPlanReady(Boolean(discoveredId)); try{discoveredId?sessionStorage.setItem(executionPlanStorageKey(storyId), discoveredId):sessionStorage.removeItem(executionPlanStorageKey(storyId));}catch{}}catch(err){if(!cancelled)setError(err instanceof Error?err.message:"Generation review could not be loaded");}})(); return()=>{cancelled=true;};},[campaignId,setError,storyId]);
  async function generateReview(){setBusy(true);setError("");try{const res=await fetch(`/api/campaigns/${campaignId}/ai-stories/${storyId}/execution/review`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({})});const data=await res.json();if(!res.ok)throw new Error(data.error??"Generation review failed");const id=typeof data.storyExecutionId==="string"?data.storyExecutionId:null;if(id){setExecutionPlanId(id);setPlanReady(true);try{sessionStorage.setItem(executionPlanStorageKey(storyId),id);}catch{}}setCompilationHash(typeof data.compilationHash==="string"?data.compilationHash:null);setSceneIntentHints(Array.isArray(data.sceneIntents)?(data.sceneIntents as SafeSceneIntentHint[]):[]);await onDone();}catch(err){setError(err instanceof Error?err.message:"Generation review failed");}finally{setBusy(false);}}
  return <div className="space-y-4"><section className="space-y-4 rounded-2xl border border-border bg-white p-5"><div><h2 className="text-lg font-bold text-navy">Generate Animation</h2><p className="mt-1 text-sm text-ink-secondary">Review readiness, then explicitly start generation. No paid retry or later Scene is started automatically.</p></div>{!planReady?<button type="button" disabled={busy||status==="executing"} onClick={()=>void generateReview()} className="brand-btn-primary" data-testid="generate-review" data-authority-action="Generate Review">Prepare generation review</button>:<p className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-900">Generation review ready</p>}</section>{executionPlanId?<StoryRuntimePanel campaignId={campaignId} storyId={storyId} executionPlanId={executionPlanId} workspaceRole={workspaceRole}/>:null}{executionPlanId&&advancedAuthorized?<details className="rounded-2xl border border-border bg-white p-5" data-testid="advanced-execution-diagnostics"><summary className="cursor-pointer text-sm font-semibold text-navy">Advanced operator review</summary><div className="mt-4"><ExecutionPlanReviewPanel campaignId={campaignId} storyId={storyId} executionPlanId={executionPlanId} storyTitle={storyTitle} storyVersionId={storyVersionId} animationPackageId={animationPackageId} compilationHash={compilationHash} workspaceRole={workspaceRole} sceneIntentHints={sceneIntentHints}/></div></details>:null}</div>;
}
