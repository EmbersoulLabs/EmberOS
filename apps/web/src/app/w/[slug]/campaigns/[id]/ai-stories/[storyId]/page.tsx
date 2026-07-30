"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AppShell, StatusBadge } from "@/components/AppShell";
import type {
  AnimationPackagePayload,
  AiStoryStructuredDraft,
  CreativeContext,
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
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    const res = await fetch(`/api/campaigns/${campaignId}/ai-stories/${storyId}`);
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Failed to load story");
      setLoading(false);
      return;
    }
    setStatus(data.story.status);
    const content = data.currentVersion?.structuredContent as AiStoryStructuredDraft | undefined;
    if (content) setDraft(content);
    setWarnings(content?.warnings ?? []);
    if (
      ["planning_review", "ready_for_execution", "planning", "failed"].includes(
        data.story.status
      )
    ) {
      const planningRes = await fetch(
        `/api/campaigns/${campaignId}/ai-stories/${storyId}/planning`
      );
      if (planningRes.ok) {
        const planningData = await planningRes.json();
        setCreativeContext(
          (planningData.creativeContext?.payload as CreativeContext | undefined) ?? null
        );
        setAnimationPackage(
          (planningData.animationPackage?.payload as AnimationPackagePayload | undefined) ??
            null
        );
      }
    } else {
      setCreativeContext(null);
      setAnimationPackage(null);
    }
    setLoading(false);
  }, [campaignId, storyId]);

  useEffect(() => {
    void load();
  }, [load]);

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

  async function approvePlanning() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(
        `/api/campaigns/${campaignId}/ai-stories/${storyId}/planning/approve`,
        { method: "POST" }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Planning approval failed");
      setStatus(data.status ?? "ready_for_execution");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Planning approval failed");
    } finally {
      setBusy(false);
    }
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
            Ready for Animation — version frozen. Generate planning to create the Animation Package.
          </div>
        ) : null}

        {status === "planning" ? (
          <div className="rounded-xl border border-brand-blue/30 bg-brand-blue/5 p-4 text-sm text-brand-blue">
            Planning in progress — building Creative Context, Director Thinking, Beats, Scenes, Shots, and Continuity.
          </div>
        ) : null}

        {status === "ready_for_execution" ? (
          <div className="rounded-xl border border-brand-teal/30 bg-brand-teal/5 p-4 text-sm font-semibold text-brand-teal">
            Animation Package READY FOR EXECUTION. Provider execution is intentionally not part of this sprint.
          </div>
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
              onClick={() => void approve()}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              Approve & freeze
            </button>
          </div>
        ) : null}

        {status === "ready_for_animation" ? (
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => void generatePlanning()}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {busy ? "Generating Planning…" : "Generate Planning"}
            </button>
          </div>
        ) : null}

        {status === "planning_review" && animationPackage ? (
          <section className="space-y-4 rounded-2xl border border-border bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-navy">Animation Package</h2>
                <p className="mt-1 text-sm text-ink-secondary">
                  Review Director Thinking, Beats, Scenes, Shots, Continuity, and Narrative Integration before execution readiness.
                </p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => void approvePlanning()}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {busy ? "Approving…" : "Approve Planning"}
              </button>
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
