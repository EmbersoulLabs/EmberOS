"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AppShell, StatusBadge } from "@/components/AppShell";
import { StoryRuntimePanel } from "@/components/ai-story/StoryRuntimePanel";
import { PlanningApprovalControl } from "@/components/ai-story/PlanningApprovalControl";
import { ExecutionPlanReviewPanel } from "@/components/ai-story-review/ExecutionPlanReviewPanel";
import { executionPlanStorageKey } from "@/lib/ai-story-review-assembly-ui";
import { fetchCurrentExecutionPlan } from "@/lib/ai-story-execution-plan-discovery-client";
import {
  STORY_PLANNING_STAGE_ORDER,
  type AnimationPackagePayload,
  type AiStoryStructuredDraft,
  type CreativeContext,
  type StoryPlanningDraft,
  type StoryPlanningStage,
  type WorkspaceRole,
} from "@ceo-agent/shared";

const EMPTY_DRAFT: AiStoryStructuredDraft = {
  title: "",
  summary: "",
  objective: "",
  targetAudience: "",
  tone: "",
  estimatedDuration: "",
  story: { opening: "", development: "", ending: "" },
  keyMessages: [],
  cta: "",
  assetReferences: [],
  warnings: [],
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

export default function AiStoryReviewPage() {
  const params = useParams();
  const slug = params.slug as string;
  const campaignId = params.id as string;
  const storyId = params.storyId as string;

  const [status, setStatus] = useState("draft");
  const [draft, setDraft] = useState<AiStoryStructuredDraft>(EMPTY_DRAFT);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [creativeContext, setCreativeContext] = useState<CreativeContext | null>(null);
  const [animationPackage, setAnimationPackage] =
    useState<AnimationPackagePayload | null>(null);
  const [planningDraft, setPlanningDraft] = useState<StoryPlanningDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [busyStage, setBusyStage] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [workspaceRole, setWorkspaceRole] = useState<WorkspaceRole | string | null>(null);
  const [storyVersionId, setStoryVersionId] = useState<string | null>(null);
  const [animationPackageRecordId, setAnimationPackageRecordId] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const meRes = await fetch("/api/me");
        if (!meRes.ok) return;
        const me = await meRes.json();
        const ws = (
          me.workspaces as Array<{ slug: string; role: string }> | undefined
        )?.find((workspace) => workspace.slug === slug);
        setWorkspaceRole(ws?.role ?? null);
      } catch {
        setWorkspaceRole(null);
      }
    })();
  }, [slug]);

  const load = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/ai-stories/${storyId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load story");

      setStatus(data.story.status);
      setStoryVersionId(
        typeof data.currentVersion?.id === "string" ? data.currentVersion.id : null
      );
      const content = data.currentVersion?.structuredContent as AiStoryStructuredDraft | undefined;
      if (content) {
        setDraft({
          ...EMPTY_DRAFT,
          ...content,
          story: {
            ...EMPTY_DRAFT.story,
            ...(content.story ?? {}),
          },
          keyMessages: content.keyMessages ?? [],
          assetReferences: content.assetReferences ?? [],
          warnings: content.warnings ?? [],
        });
      }
      setWarnings(content?.warnings ?? []);
      if (
        [
          "planning_review",
          "ready_for_execution",
          "planning",
          "ready_for_animation",
          "generate_review",
          "executing",
          "execution_review",
          "execution_failed",
          "failed",
        ].includes(data.story.status)
      ) {
        const planningRes = await fetch(
          `/api/campaigns/${campaignId}/ai-stories/${storyId}/planning`
        );
        if (planningRes.ok) {
          const planningData = await planningRes.json();
          setCreativeContext(
            (planningData.creativeContext?.payload as CreativeContext | undefined) ?? null
          );
          setPlanningDraft(
            (planningData.planningDraft as StoryPlanningDraft | undefined) ?? null
          );
          setAnimationPackage(
            (planningData.completePackage as AnimationPackagePayload | undefined) ??
              (planningData.animationPackage?.payload &&
              !("kind" in (planningData.animationPackage.payload as object))
                ? (planningData.animationPackage.payload as AnimationPackagePayload)
                : null)
          );
          setAnimationPackageRecordId(
            typeof planningData.animationPackage?.id === "string"
              ? planningData.animationPackage.id
              : null
          );
        }
      } else {
        setCreativeContext(null);
        setAnimationPackage(null);
        setPlanningDraft(null);
        setAnimationPackageRecordId(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load story");
    } finally {
      setLoading(false);
    }
  }, [campaignId, storyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const completedStages = useMemo(
    () => new Set(planningDraft?.completedStages ?? []),
    [planningDraft]
  );

  async function saveDraft() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/ai-stories/${storyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ structuredContent: draft }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    setBusy(true);
    setError("");
    try {
      await saveDraft();
      const res = await fetch(
        `/api/campaigns/${campaignId}/ai-stories/${storyId}/approve`,
        { method: "POST" }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Approve failed");
      setStatus(data.status ?? "ready_for_animation");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approve failed");
    } finally {
      setBusy(false);
    }
  }

  async function rewriteStory() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(
        `/api/campaigns/${campaignId}/ai-stories/${storyId}/rewrite`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Rewrite failed");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rewrite failed");
    } finally {
      setBusy(false);
    }
  }

  async function generatePlanning() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(
        `/api/campaigns/${campaignId}/ai-stories/${storyId}/planning/generate`,
        { method: "POST" }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Planning generation failed");
      setStatus(data.status ?? "planning_review");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Planning generation failed");
    } finally {
      setBusy(false);
    }
  }

  async function runStage(stage: StoryPlanningStage) {
    setBusy(true);
    setBusyStage(stage);
    setError("");
    try {
      const res = await fetch(
        `/api/campaigns/${campaignId}/ai-stories/${storyId}/planning/stages/${stage}`,
        { method: "POST" }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Stage ${stage} failed`);
      setStatus(data.status ?? status);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Stage ${stage} failed`);
    } finally {
      setBusy(false);
      setBusyStage(null);
    }
  }

  async function runScreenwriter(action: "characters" | "dialogue" | "narrative") {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(
        `/api/campaigns/${campaignId}/ai-stories/${storyId}/screenwriter`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Screenwriter ${action} failed`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Screenwriter ${action} failed`);
    } finally {
      setBusy(false);
    }
  }

  function stageEnabled(stage: StoryPlanningStage): boolean {
    const index = STORY_PLANNING_STAGE_ORDER.indexOf(stage);
    if (index === 0) return true;
    const prior = STORY_PLANNING_STAGE_ORDER[index - 1]!;
    return completedStages.has(prior) || Boolean(creativeContext && stage === "director_thinking");
  }

  if (loading) {
    return (
      <AppShell>
        <p className="text-sm text-ink-secondary">Loading story…</p>
      </AppShell>
    );
  }

  const readOnly = [
    "ready_for_animation",
    "planning",
    "planning_review",
    "ready_for_execution",
    "archived",
  ].includes(status);

  const planningActive = [
    "ready_for_animation",
    "planning",
    "planning_review",
    "failed",
  ].includes(status);

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link
              href={`/w/${slug}/campaigns/${campaignId}`}
              className="text-sm text-brand-blue hover:underline"
            >
              ← Campaign
            </Link>
            <h1 className="mt-2 text-2xl font-bold text-navy">Story Draft</h1>
          </div>
          <StatusBadge status={status} />
        </div>

        {status === "ready_for_animation" ? (
          <div className="rounded-xl border border-brand-teal/30 bg-brand-teal/5 p-4 text-sm text-brand-teal">
            Ready for Animation — version frozen. Generate planning stages to create the Animation Package.
          </div>
        ) : null}

        {status === "planning" ? (
          <div className="rounded-xl border border-brand-blue/30 bg-brand-blue/5 p-4 text-sm text-brand-blue">
            Planning in progress — run each stage or Generate All Planning.
          </div>
        ) : null}

        {status === "ready_for_execution" ? (
          <div className="rounded-xl border border-brand-teal/30 bg-brand-teal/5 p-4 text-sm font-semibold text-brand-teal">
            Animation Package READY FOR EXECUTION. Open Generate Review to compile Scene Execution Intents, run AI QC, and auto-save the Execution Plan (provider execution remains locked).
          </div>
        ) : null}

        {status === "ready_for_execution" ||
        status === "generate_review" ||
        status === "executing" ||
        status === "execution_review" ||
        status === "execution_failed" ? (
          <ExecutionPanel
            campaignId={campaignId}
            storyId={storyId}
            status={status}
            busy={busy}
            setBusy={setBusy}
            setError={setError}
            onDone={load}
            workspaceRole={workspaceRole}
            storyTitle={draft.title}
            storyVersionId={storyVersionId}
            animationPackageId={animationPackageRecordId}
          />
        ) : null}

        {warnings.length > 0 ? (
          <ul className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            {warnings.map((w) => (
              <li key={w}>• {w}</li>
            ))}
          </ul>
        ) : null}

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <div className="grid gap-4">
          {(
            [
              ["title", "Title"],
              ["summary", "Summary"],
              ["objective", "Objective"],
              ["targetAudience", "Target audience"],
              ["tone", "Tone"],
              ["estimatedDuration", "Estimated duration"],
              ["cta", "CTA"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="block space-y-1">
              <span className="text-sm font-medium text-navy">{label}</span>
              <input
                className="w-full rounded-lg border border-border px-3 py-2 text-sm disabled:bg-slate-50"
                value={draft[key]}
                disabled={readOnly}
                onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
              />
            </label>
          ))}

          {(["opening", "development", "ending"] as const).map((part) => (
            <label key={part} className="block space-y-1">
              <span className="text-sm font-medium text-navy capitalize">{part}</span>
              <textarea
                className="min-h-[100px] w-full rounded-lg border border-border px-3 py-2 text-sm disabled:bg-slate-50"
                value={draft.story[part]}
                disabled={readOnly}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    story: { ...d.story, [part]: e.target.value },
                  }))
                }
              />
            </label>
          ))}
        </div>

        {!readOnly ? (
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => void saveDraft()}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium"
            >
              Save edits
            </button>
            <button
              type="button"
              disabled={busy || status === "generating"}
              onClick={() => void rewriteStory()}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium"
            >
              {busy ? "Rewriting…" : "Rewrite Story"}
            </button>
            <button
              type="button"
              disabled={busy || status === "generating"}
              onClick={() => void approve()}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              Approve & freeze
            </button>
          </div>
        ) : null}

        {planningActive ? (
          <section className="space-y-4 rounded-2xl border border-border bg-white p-5">
            <div>
              <h2 className="text-lg font-bold text-navy">Story Planning</h2>
              <p className="mt-1 text-sm text-ink-secondary">
                Run stages in order, or generate the full Animation Package at once. No provider execution.
              </p>
            </div>

            {status !== "planning_review" && status !== "ready_for_execution" ? (
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void generatePlanning()}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                >
                  {busy && !busyStage ? "Generating Planning…" : "Generate All Planning"}
                </button>
              </div>
            ) : null}

            <div className="grid gap-2">
              {STORY_PLANNING_STAGE_ORDER.map((stage) => {
                const done = completedStages.has(stage) ||
                  (stage === "animation_package" && Boolean(animationPackage));
                const enabled = stageEnabled(stage);
                return (
                  <div
                    key={stage}
                    className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-2 last:border-0"
                  >
                    <div>
                      <p className="text-sm font-medium text-navy">{STAGE_LABELS[stage]}</p>
                      <p className="text-xs text-ink-secondary">
                        {done ? "Complete" : enabled ? "Ready" : "Waiting on prior stage"}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={busy || !enabled || status === "ready_for_execution"}
                      onClick={() => void runStage(stage)}
                      className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                    >
                      {busyStage === stage
                        ? "Running…"
                        : done
                          ? `Regenerate ${STAGE_LABELS[stage].replace(/^Generate |^Assemble /, "")}`
                          : STAGE_LABELS[stage]}
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap gap-3 border-t border-border pt-4">
              <button
                type="button"
                disabled={busy || status === "ready_for_execution"}
                onClick={() => void runScreenwriter("characters")}
                className="rounded-lg border border-border px-3 py-1.5 text-sm"
              >
                Generate Characters
              </button>
              <button
                type="button"
                disabled={busy || status === "ready_for_execution"}
                onClick={() => void runScreenwriter("dialogue")}
                className="rounded-lg border border-border px-3 py-1.5 text-sm"
              >
                Generate Dialogue
              </button>
              <button
                type="button"
                disabled={busy || status === "ready_for_execution"}
                onClick={() => void runScreenwriter("narrative")}
                className="rounded-lg border border-border px-3 py-1.5 text-sm"
              >
                Generate Narrative
              </button>
            </div>

            {creativeContext ? (
              <PackageSection title="Creative Context" value={creativeContext} />
            ) : null}
            {planningDraft ? (
              <PackageSection
                title="Planning Draft Progress"
                value={{
                  completedStages: planningDraft.completedStages,
                  beats: planningDraft.storyBeats?.length ?? 0,
                  scenes: planningDraft.scenePlan?.length ?? 0,
                  shots: planningDraft.shotPlan?.length ?? 0,
                }}
              />
            ) : null}
          </section>
        ) : null}

        {(status === "planning_review" || status === "ready_for_execution") &&
        animationPackage ? (
          <section className="space-y-4 rounded-2xl border border-border bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-navy">Animation Package</h2>
                <p className="mt-1 text-sm text-ink-secondary">
                  Review Director Thinking, Beats, Scenes, Shots, Continuity, and Narrative Integration before execution readiness.
                </p>
              </div>
              {status === "planning_review" ? (
                <PlanningApprovalControl
                  campaignId={campaignId}
                  storyId={storyId}
                  storyVersionId={storyVersionId}
                  animationPackageId={animationPackageRecordId}
                  disabled={busy}
                  onApproved={async (nextStatus) => {
                    setStatus(nextStatus);
                    await load();
                  }}
                  onError={setError}
                />
              ) : null}
            </div>

            <PackageSection title="Director Thinking" value={animationPackage.directorThinking} />
            <PackageSection title="Beats" value={animationPackage.storyBeats} />
            <PackageSection title="Scenes" value={animationPackage.scenePlan} />
            <PackageSection title="Shots" value={animationPackage.shotPlan} />
            <PackageSection
              title="Continuity"
              value={{
                characters: animationPackage.characterContinuity,
                world: animationPackage.worldContinuity,
                creativeContext,
              }}
            />
            <PackageSection
              title="Narrative Integration"
              value={animationPackage.narrativeIntegration}
            />
          </section>
        ) : null}
      </div>
    </AppShell>
  );
}

function PackageSection({ title, value }: { title: string; value: unknown }) {
  return (
    <div className="rounded-xl border border-border bg-surface-muted p-4">
      <h3 className="text-sm font-semibold text-navy">{title}</h3>
      <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap text-xs text-ink-secondary">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

type SafeSceneIntentHint = {
  sceneExecutionId: string;
  sceneId?: string;
  sceneOrder?: number;
  purpose?: string;
  plannedDurationMs?: number;
  shotCount?: number;
  referencedAssetIds?: string[];
};

function ExecutionPanel({
  campaignId,
  storyId,
  status,
  busy,
  setBusy,
  setError,
  onDone,
  workspaceRole,
  storyTitle,
  storyVersionId,
  animationPackageId,
}: {
  campaignId: string;
  storyId: string;
  status: string;
  busy: boolean;
  setBusy: (v: boolean) => void;
  setError: (v: string) => void;
  onDone: () => Promise<void>;
  workspaceRole: WorkspaceRole | string | null;
  storyTitle: string;
  storyVersionId: string | null;
  animationPackageId: string | null;
}) {
  const [persistenceStatus, setPersistenceStatus] = useState<string | null>(null);
  const [planSavedLabel, setPlanSavedLabel] = useState<string | null>(null);
  const [executionPlanId, setExecutionPlanId] = useState<string | null>(null);
  const [compilationHash, setCompilationHash] = useState<string | null>(null);
  const [sceneIntentHints, setSceneIntentHints] = useState<SafeSceneIntentHint[]>([]);
  const [overallQcStatus, setOverallQcStatus] = useState<string | null>(null);
  const [sceneIntentCount, setSceneIntentCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function discoverPersistedPlan() {
      try {
        const data = await fetchCurrentExecutionPlan({ campaignId, storyId });
        if (cancelled) return;

        const discoveredId =
          typeof data.executionPlan?.executionPlanId === "string"
            ? data.executionPlan.executionPlanId
            : null;
        setExecutionPlanId(discoveredId);
        setSceneIntentCount(
          typeof data.executionPlan?.sceneIntentCount === "number"
            ? data.executionPlan.sceneIntentCount
            : null
        );
        setPlanSavedLabel(discoveredId ? "Plan Saved" : null);
        setPersistenceStatus(discoveredId ? "reloaded" : null);
        try {
          if (discoveredId) {
            sessionStorage.setItem(executionPlanStorageKey(storyId), discoveredId);
          } else {
            sessionStorage.removeItem(executionPlanStorageKey(storyId));
          }
        } catch {
          // sessionStorage is only an optional cache.
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Execution Plan discovery failed");
        }
      }
    }

    void discoverPersistedPlan();
    return () => {
      cancelled = true;
    };
  }, [campaignId, setError, storyId]);

  async function generateReview() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(
        `/api/campaigns/${campaignId}/ai-stories/${storyId}/execution/review`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Generate Review failed");
      setPersistenceStatus(
        typeof data.persistenceStatus === "string" ? data.persistenceStatus : null
      );
      setPlanSavedLabel(
        data.persistenceStatus === "persisted" || data.persistenceStatus === "reloaded"
          ? "Plan Saved"
          : null
      );
      setOverallQcStatus(
        typeof data.qc?.overallStatus === "string" ? data.qc.overallStatus : null
      );
      setSceneIntentCount(
        typeof data.sceneIntentCount === "number" ? data.sceneIntentCount : null
      );
      setCompilationHash(
        typeof data.compilationHash === "string" ? data.compilationHash : null
      );
      const planId =
        typeof data.storyExecutionId === "string" ? data.storyExecutionId : null;
      if (planId) {
        setExecutionPlanId(planId);
        try {
          sessionStorage.setItem(executionPlanStorageKey(storyId), planId);
        } catch {
          // ignore
        }
      }
      const intents = Array.isArray(data.sceneIntents)
        ? (data.sceneIntents as SafeSceneIntentHint[]).map((intent) => ({
            sceneExecutionId: intent.sceneExecutionId,
            sceneId: intent.sceneId,
            sceneOrder: intent.sceneOrder,
            plannedDurationMs: intent.plannedDurationMs,
            shotCount: intent.shotCount,
            referencedAssetIds: intent.referencedAssetIds,
          }))
        : [];
      setSceneIntentHints(intents);
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generate Review failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="space-y-4 rounded-2xl border border-border bg-white p-5">
        <div>
          <h2 className="text-lg font-bold text-navy">Execution Engine</h2>
          <p className="mt-1 text-sm text-ink-secondary">
            Phase 2A: Generate Review compiles Scene Execution Intents, runs Plan QC, and
            automatically saves the Execution Plan when Plan QC passes. Plan QC does not
            approve generated media. Provider execution remains locked.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            disabled={busy || status === "executing"}
            onClick={() => void generateReview()}
            className="brand-btn-primary"
            data-testid="generate-review"
          >
            Generate Review
          </button>
        </div>
        {planSavedLabel ? (
          <div className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-900">
            {planSavedLabel}
            {persistenceStatus === "reloaded" ? " · existing plan reloaded" : null}
            {sceneIntentCount != null ? ` · ${sceneIntentCount} scenes` : null}
            {overallQcStatus ? ` · Plan QC ${overallQcStatus}` : null}
          </div>
        ) : null}
        {persistenceStatus === "skipped_qc_failed" ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Plan not saved — Plan QC reported blocking findings.
          </div>
        ) : null}
        <p className="text-xs text-ink-secondary" data-testid="phase2a-execution-locked">
          Legacy Execute / Retry / Export remain locked. Use Story Runtime Execute below when the
          plan is READY_FOR_EXECUTION.
        </p>
      </section>

      {executionPlanId ? (
        <StoryRuntimePanel
          campaignId={campaignId}
          storyId={storyId}
          executionPlanId={executionPlanId}
          workspaceRole={workspaceRole}
        />
      ) : null}

      {executionPlanId ? (
        <ExecutionPlanReviewPanel
          campaignId={campaignId}
          storyId={storyId}
          executionPlanId={executionPlanId}
          storyTitle={storyTitle}
          storyVersionId={storyVersionId}
          animationPackageId={animationPackageId}
          compilationHash={compilationHash}
          workspaceRole={workspaceRole}
          sceneIntentHints={sceneIntentHints}
        />
      ) : null}
    </div>
  );
}
