"use client";

import { useRef, useState } from "react";
import type { GeneratedSceneReviewReadModel, HumanCreativeRejectionReason, WorkspaceRole } from "@ceo-agent/shared";
import {
  StoryRuntimeClientError,
  postGeneratedSceneReviewDecision,
  postPreDispatchRecovery,
  postSceneRetryAuthorization,
  postSceneRetryInputRevision,
} from "@/lib/ai-story-runtime-client";

type Props = { campaignId: string; storyId: string; executionPlanId: string; workspaceRole: WorkspaceRole | string | null; scenes: readonly GeneratedSceneReviewReadModel[]; onChanged: () => Promise<unknown> };
const OPERATOR_ROLES = new Set(["admin", "operator"]);

function statusLabel(state: GeneratedSceneReviewReadModel["runtimeState"]): string {
  return ({ AUTHORIZED_NOT_RELEASED: "Ready — waiting for the previous Scene", QUEUED: "Ready", PRE_DISPATCH_BLOCKED: "Generation couldn’t start", RUNNING: "Generating", PENDING_REVIEW: "Needs review", REJECTED: "Needs changes", RETRY_AUTHORIZED: "Ready to generate again", APPROVED: "Approved", FAILED: "Generation failed" } as const)[state];
}
function qcLabel(status: NonNullable<GeneratedSceneReviewReadModel["postGenerationQcEvidence"]>["aggregateStatus"]) {
  return ({ POST_QC_PASS: ["Quality check complete", "border-emerald-200 bg-emerald-50 text-emerald-900"], POST_QC_WARN: ["Check recommended", "border-amber-200 bg-amber-50 text-amber-900"], POST_QC_REJECT: ["Needs changes", "border-red-200 bg-red-50 text-red-900"], POST_QC_REQUIRES_HUMAN_CONFIRMATION: ["Please verify", "border-sky-200 bg-sky-50 text-sky-900"] } as const)[status];
}
function repairAction(owner: string): string {
  if (owner === "PROVIDER_EXECUTION") return "Try generating this Scene again";
  if (owner === "CHARACTER_AUTHORITY") return "Review the Character and reference photo";
  if (owner === "LOCATION_AUTHORITY") return "Review the Location reference";
  if (owner === "PRODUCT_AUTHORITY") return "Review the Product reference";
  if (owner === "SCRIPT" || owner === "SCENE") return "Edit what happens in this Scene";
  if (owner === "DIRECTOR" || owner === "MOTION") return "Adjust the Scene action";
  return "Inspect the result and choose the next step";
}
function rejectionReason(scene: GeneratedSceneReviewReadModel): HumanCreativeRejectionReason {
  const category = scene.postGenerationQcEvidence?.findings.find((finding) => finding.result === "REJECT")?.category;
  if (category === "PRODUCT_FIDELITY") return "PRODUCT_IDENTITY_DRIFT";
  if (category === "DIRECTOR_EXECUTION" || category === "MOTION_EXECUTION") return "CAMERA_MOTION_UNACCEPTABLE";
  if (category === "CONTINUITY" || category === "CHARACTER_FIDELITY" || category === "LOCATION_FIDELITY") return "CONTINUITY_UNACCEPTABLE";
  if (category === "VISUAL_ARTIFACTS" || category === "OUTPUT_INTEGRITY") return "VISUAL_QUALITY_UNACCEPTABLE";
  return "INSUFFICIENT_SCENE_DIFFERENTIATION";
}

export function SceneReviewWorkspacePanel({ campaignId, storyId, executionPlanId, workspaceRole, scenes, onChanged }: Props) {
  const canDecide = OPERATOR_ROLES.has(String(workspaceRole ?? ""));
  const [busyScene, setBusyScene] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const [revisionIds, setRevisionIds] = useState<Record<string, string>>({});
  const [authorizationIds, setAuthorizationIds] = useState<Record<string, string>>({});
  const [promotedLocations, setPromotedLocations] = useState<Record<string, true>>({});

  async function run(scene: GeneratedSceneReviewReadModel, operation: () => Promise<unknown>) {
    if (inFlight.current) return;
    inFlight.current = true; setBusyScene(scene.sceneExecutionId); setError(null);
    try { await operation(); } catch (reason) { setError(reason instanceof StoryRuntimeClientError ? reason.message : reason instanceof Error ? reason.message : "This action could not be completed."); }
    finally { inFlight.current = false; setBusyScene(null); }
  }
  async function decide(scene: GeneratedSceneReviewReadModel, action: "approve" | "retry" | "reject") {
    if (!canDecide) return;
    await run(scene, async () => { await postGeneratedSceneReviewDecision({ campaignId, storyId, executionPlanId, sceneExecutionId: scene.sceneExecutionId, action, attemptId: scene.latestAttemptId ?? undefined, ...(action === "reject" ? { rejection: { reason: rejectionReason(scene) } } : {}), ...(action === "retry" ? { retryAuthorizationId: authorizationIds[scene.sceneExecutionId] ?? scene.retryAuthorizationId ?? undefined } : {}) }); await onChanged(); });
  }
  async function prepareRepair(scene: GeneratedSceneReviewReadModel) {
    if (!scene.latestReviewId) return;
    await run(scene, async () => { const revision = await postSceneRetryInputRevision({ campaignId, storyId, executionPlanId, sceneExecutionId: scene.sceneExecutionId, sourceReviewId: scene.latestReviewId!, creativeDirection: { visualRole: "SECONDARY_DETAIL_REVEAL", cameraInstruction: "MINOR_LATERAL_DOLLY", focusProgression: ["PRIMARY_PRODUCT_DETAIL", "SECONDARY_PRODUCT_DETAIL"], shotEmphasis: "DISTINCT_SCENE_VISUAL_BEAT", pacing: "SMALL_BOUNDED" } }); setRevisionIds((current) => ({ ...current, [scene.sceneExecutionId]: revision.retryInputRevisionId })); });
  }
  async function confirmCost(scene: GeneratedSceneReviewReadModel) {
    const retryInputRevisionId = revisionIds[scene.sceneExecutionId] ?? scene.retryInputRevisionId;
    if (!scene.latestReviewId || !retryInputRevisionId) return;
    await run(scene, async () => { const authorization = await postSceneRetryAuthorization({ campaignId, storyId, executionPlanId, sceneExecutionId: scene.sceneExecutionId, sourceReviewId: scene.latestReviewId!, retryInputRevisionId }); setAuthorizationIds((current) => ({ ...current, [scene.sceneExecutionId]: authorization.retryAuthorizationId })); });
  }
  async function recover(scene: GeneratedSceneReviewReadModel) {
    await run(scene, async () => { await postPreDispatchRecovery({ campaignId, storyId, executionPlanId, sceneExecutionId: scene.sceneExecutionId }); await onChanged(); });
  }
  async function promoteLocation(scene: GeneratedSceneReviewReadModel) {
    await run(scene, async () => {
      const response = await fetch(`/api/campaigns/${campaignId}/ai-stories/${storyId}/scenes/${scene.sceneId}/location/promotion`, { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "This Location could not be saved for reuse.");
      setPromotedLocations((current) => ({ ...current, [scene.sceneExecutionId]: true }));
    });
  }

  if (!scenes.length) return <section className="rounded-2xl border border-dashed border-border bg-white p-6 text-center" data-testid="scene-review-empty"><h2 className="text-lg font-bold text-navy">Scenes</h2><p className="mt-2 text-sm text-ink-secondary">No Scenes are ready for generation or review yet.</p></section>;
  const approved = scenes.filter((scene) => scene.runtimeState === "APPROVED").length;
  return <section className="space-y-4" data-testid="scene-review-workspace" aria-labelledby="scene-workspace-heading">
    <div className="rounded-2xl border border-border bg-white p-5 sm:flex sm:items-end sm:justify-between sm:gap-4"><div><h2 id="scene-workspace-heading" className="text-xl font-bold text-navy">Scenes</h2><p className="mt-1 text-sm text-ink-secondary">See who and what matters, then review each generated result.</p></div><p className="mt-3 text-sm font-semibold text-navy sm:mt-0" data-testid="story-review-progress">{approved} of {scenes.length} Scenes approved</p></div>
    <nav className="flex gap-2 overflow-x-auto pb-1" aria-label="Scene navigation" data-testid="scene-navigation">{scenes.map((scene) => <a key={scene.sceneExecutionId} href={`#scene-${scene.sceneOrder + 1}`} className="shrink-0 rounded-full border border-border bg-white px-3 py-1.5 text-sm text-navy hover:bg-surface-muted">Scene {scene.sceneOrder + 1}</a>)}</nav>
    <div className="space-y-4">{scenes.map((scene, index) => {
      const view = scene.presentation; const qc = scene.postGenerationQcEvidence; const qcState = qc ? qcLabel(qc.aggregateStatus) : null;
      const retryInputRevisionId = revisionIds[scene.sceneExecutionId] ?? scene.retryInputRevisionId; const retryAuthorizationId = authorizationIds[scene.sceneExecutionId] ?? scene.retryAuthorizationId;
      const pending = scene.runtimeState === "PENDING_REVIEW" && scene.reviewState === "PENDING_REVIEW" && scene.reviewAvailable && Boolean(scene.latestAttemptId && scene.generatedMedia) && !scene.running;
      const hardFailure = Boolean(qc?.findings.some((finding) => finding.result === "REJECT" && finding.waiverPolicy === "NON_WAIVABLE_INTEGRITY"));
      return <article id={`scene-${scene.sceneOrder + 1}`} key={scene.sceneExecutionId} className="scroll-mt-4 overflow-hidden rounded-2xl border border-border bg-white" data-testid={`scene-review-card-${scene.sceneOrder}`}>
        <header className="border-b border-border bg-surface-muted/50 p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-blue">Scene {scene.sceneOrder + 1}</p><h3 className="mt-1 break-words text-lg font-bold text-navy">{view?.summary ?? `Story Scene ${scene.sceneOrder + 1}`}</h3>{view ? <p className="mt-1 text-sm text-ink-secondary">{view.purpose}{view.transitional ? " · Story transition" : ""}</p> : <p className="mt-1 text-sm text-ink-secondary">Historical Scene details are limited, but its saved result remains available.</p>}</div><span className="rounded-full border border-border bg-white px-3 py-1 text-xs font-semibold text-navy" role="status">{statusLabel(scene.runtimeState)}</span></div></header>
        <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.9fr)]"><div className="min-w-0 space-y-4">{view ? <>
          <div className="grid gap-3 sm:grid-cols-2"><section aria-label="Who is in this Scene"><h4 className="text-sm font-semibold text-navy">Who</h4>{view.cast.length ? <ul className="mt-2 flex flex-wrap gap-2">{view.cast.map((member) => <li key={`${member.kind}:${member.castId}`} className="max-w-full rounded-lg border border-border px-3 py-2"><span className="block break-words text-sm font-medium text-navy">{member.displayName}</span><span className="block text-xs text-ink-secondary">{member.kind}{member.recurringInStory ? " · Recurring" : ""}{member.referenceAssetIds.length ? " · Reference photo" : ""}</span></li>)}</ul> : <p className="mt-2 text-sm text-ink-secondary">No named Characters in this Scene.</p>}</section><section aria-label="Where this Scene happens"><h4 className="text-sm font-semibold text-navy">Where</h4>{view.location ? <div className="mt-2 rounded-lg border border-border px-3 py-2"><p className="break-words text-sm font-medium text-navy">{view.location.displayName}</p><p className="text-xs text-ink-secondary">{view.location.kind}{view.location.referenceAssetIds.length ? " · Visual reference" : ""}</p>{promotedLocations[scene.sceneExecutionId] ? <p className="mt-2 text-xs font-medium text-emerald-800" role="status">Saved for future use. This Scene keeps its original Location history.</p> : canDecide && view.location.promotionAction ? <button type="button" className="mt-2 text-left text-xs font-semibold text-brand-blue hover:underline" disabled={busyScene === scene.sceneExecutionId} onClick={() => void promoteLocation(scene)}>{view.location.promotionAction === "SAVE_FOR_STORY" ? "Save for reuse in this Story" : "Keep for future Stories"}</button> : view.location.promotionAction ? <p className="mt-1 text-xs text-brand-blue">{view.location.promotionAction === "SAVE_FOR_STORY" ? "Can be saved for reuse in this Story" : "Can be kept for future Stories in this Campaign"}</p> : null}</div> : <p className="mt-2 text-sm text-ink-secondary">No Location detail is available.</p>}</section></div>
          {view.products.length ? <section><h4 className="text-sm font-semibold text-navy">Product or important object</h4><ul className="mt-2 flex flex-wrap gap-2">{view.products.map((product) => <li key={product.productAuthorityId} className="rounded-lg border border-border px-3 py-2 text-sm text-navy">{product.displayName} <span className="text-xs text-ink-secondary">· Reference available</span></li>)}</ul></section> : null}
          <section><h4 className="text-sm font-semibold text-navy">What happens</h4><ol className="mt-2 space-y-2 text-sm text-ink-secondary">{view.actionSummary.map((action, actionIndex) => <li key={`${actionIndex}:${action}`} className="flex gap-2"><span className="font-semibold text-brand-blue">{actionIndex + 1}</span><span className="break-words">{action}</span></li>)}</ol></section>
          {(view.startsWith.length || view.endsWith.length) ? <details className="rounded-xl border border-border p-3"><summary className="cursor-pointer text-sm font-semibold text-navy">Continuity for this Scene</summary><div className="mt-3 grid gap-3 text-sm sm:grid-cols-2"><div><p className="font-medium text-navy">Starts with</p><ul className="mt-1 text-ink-secondary">{view.startsWith.map((fact) => <li key={fact}>• {fact}</li>)}</ul></div><div><p className="font-medium text-navy">Ends with</p><ul className="mt-1 text-ink-secondary">{view.endsWith.map((fact) => <li key={fact}>• {fact}</li>)}</ul></div></div>{view.continuityNotes.length ? <ul className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{view.continuityNotes.map((note) => <li key={note}>• {note}</li>)}</ul> : null}</details> : null}
        </> : null}</div><div className="min-w-0 space-y-4">
          <section aria-label="Generated result"><h4 className="text-sm font-semibold text-navy">Generated result</h4>{scene.generatedMedia ? <div className="mt-2" data-testid={`generated-scene-media-${scene.sceneOrder}`}>{scene.generatedMedia.deliveryUrl ? <video className="aspect-video w-full rounded-xl border border-border bg-black" controls preload="metadata" src={scene.generatedMedia.deliveryUrl} aria-label={`Generated video for Scene ${scene.sceneOrder + 1}`} data-testid={`generated-scene-media-preview-${scene.sceneOrder}`}>Your browser does not support video playback.</video> : <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{scene.generatedMedia.safeError ?? "The video preview is temporarily unavailable."}</p>}</div> : <p className="mt-2 rounded-lg border border-dashed border-border p-3 text-sm text-ink-secondary">No generated result yet.</p>}</section>
          <section aria-label="Quality review" className="space-y-2"><h4 className="text-sm font-semibold text-navy">Quality review</h4>{qc && qcState ? <div className={`rounded-xl border p-3 ${qcState[1]}`} data-testid={`post-qc-status-${scene.sceneOrder}`}><p className="font-semibold">{qcState[0]}</p><p className="mt-1 text-sm">{qc.aggregateStatus === "POST_QC_PASS" ? "The checks found evidence that this Scene meets its requirements. Your approval is still required." : qc.aggregateStatus === "POST_QC_REQUIRES_HUMAN_CONFIRMATION" ? "Some required details could not be verified automatically. Please inspect the video." : "Review the findings below before deciding."}</p></div> : <p className="rounded-lg border border-dashed border-border p-3 text-sm text-ink-secondary">Quality evidence is not available yet. No approval has been assumed.</p>}{qc?.findings.some((finding) => finding.result !== "PASS") ? <ul className="space-y-2" data-testid={`post-qc-evidence-${scene.sceneOrder}`}>{qc.findings.filter((finding) => finding.result !== "PASS").map((finding, findingIndex) => <li key={`${findingIndex}:${finding.reason}`} className="rounded-lg border border-border p-3"><p className="text-sm font-medium text-navy">{finding.reason}</p><p className="mt-1 text-xs text-ink-secondary">{finding.evidenceSummary}</p><p className="mt-2 text-xs font-medium text-brand-blue">{repairAction(finding.repairOwner)}</p>{finding.result === "UNVERIFIED" ? <p className="mt-1 text-xs text-ink-secondary">Needs your verification</p> : null}</li>)}</ul> : null}</section>
          {canDecide && pending ? <div className="space-y-2 border-t border-border pt-4" data-testid={`scene-review-actions-${scene.sceneOrder}`}><button type="button" className="brand-btn-primary w-full" disabled={busyScene === scene.sceneExecutionId || hardFailure} aria-disabled={hardFailure} onClick={() => void decide(scene, "approve")}>Approve Scene</button>{hardFailure ? <p className="text-xs text-red-800">This result has a non-waivable integrity issue. Choose Needs changes.</p> : null}<button type="button" className="w-full rounded-lg border border-border px-3 py-2 text-sm font-semibold text-navy" disabled={busyScene === scene.sceneExecutionId} onClick={() => void decide(scene, "reject")}>Needs changes</button></div> : null}
          {canDecide && (scene.runtimeState === "REJECTED" || scene.runtimeState === "RETRY_AUTHORIZED") ? <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3" data-testid={`generated-scene-revise-retry-${scene.sceneOrder}`}><p className="text-sm font-medium text-amber-950">Choose a deliberate repair before spending again.</p>{!retryInputRevisionId ? <button type="button" className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm" onClick={() => void prepareRepair(scene)} disabled={busyScene === scene.sceneExecutionId}>Review changes</button> : null}{retryInputRevisionId && !retryAuthorizationId ? <button type="button" className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm" onClick={() => void confirmCost(scene)} disabled={busyScene === scene.sceneExecutionId}>Confirm generation cost</button> : null}{retryAuthorizationId ? <button type="button" className="brand-btn-primary w-full" onClick={() => void decide(scene, "retry")} disabled={busyScene === scene.sceneExecutionId}>Generate again</button> : null}<p className="text-xs text-amber-900">Nothing retries automatically.</p></div> : null}
          {canDecide && scene.runtimeState === "PRE_DISPATCH_BLOCKED" && scene.recoveryMode === "HUMAN_RETRY_FROM_PRE_PROVIDER_FAILURE" ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-3"><button type="button" className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm" disabled={busyScene === scene.sceneExecutionId} onClick={() => void recover(scene)}>Try starting generation again</button><p className="mt-2 text-xs text-amber-900">No paid attempt starts automatically.</p></div> : null}
          {scene.attempts.length > 1 ? <details className="rounded-xl border border-border p-3" data-testid={`scene-attempt-history-${scene.sceneOrder}`}><summary className="cursor-pointer text-sm font-semibold text-navy">Previous results ({scene.attempts.length})</summary><ol className="mt-2 space-y-1 text-sm text-ink-secondary">{scene.attempts.map((attempt) => <li key={attempt.attemptId}>Generation {attempt.attemptNumber}: {attempt.reviewState === "APPROVED" ? "Approved" : attempt.outcome === "success" ? "Available for review" : attempt.outcome === "failure" ? "Failed" : "Processing"}</li>)}</ol></details> : null}
        </div></div>
        <footer className="flex items-center justify-between border-t border-border px-4 py-3 text-sm sm:px-5"><span className="text-ink-secondary">Scene {scene.sceneOrder + 1} of {scenes.length}</span><div className="flex gap-3">{index > 0 ? <a href={`#scene-${scene.sceneOrder}`} className="text-brand-blue hover:underline">Previous</a> : null}{index < scenes.length - 1 ? <a href={`#scene-${scene.sceneOrder + 2}`} className="text-brand-blue hover:underline">Next Scene</a> : null}</div></footer>
      </article>;
    })}</div>
    {error ? <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{error}</p> : null}
  </section>;
}
