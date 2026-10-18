"use client";
import { useEffect, useState } from "react";
import { postQcAllowsHumanApproval, type AiStoryPostGenerationQcEvaluation, type AiStoryPostQcRequirement } from "@ceo-agent/shared";
import {
  approveActionLabel,
  continuityStatusLabel,
  operatorRequirementLabel,
  postQcTerminalLabel,
  qcActionLabel,
  visibleOperatorRequirements,
} from "./local-generation-operator-feedback";

type ContinuityJob = { state: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED"; errorCode: string | null } | null;
type CommercialAudio = {
  finalPolicy: string;
  blockers: string[];
  recommendation: { trackId: string; name: string; license: string | null; alternatives: { trackId: string; name: string }[] } | null;
  assembly: { state: string; trackId: string | null; hasAudio: boolean; errorCode: string | null } | null;
};
type Model = {
  generationResultId: string;
  playbackUrl: string | null;
  sourcePlaybackUrl?: string | null;
  reviewedMedia?: "ASSEMBLED_OUTPUT" | "GENERATION_SOURCE";
  commercialAudio?: CommercialAudio;
  requirements: AiStoryPostQcRequirement[];
  evaluation: AiStoryPostGenerationQcEvaluation | null;
  decision: { decision: string } | null;
  continuityFrame: unknown | null;
  continuityJob: ContinuityJob;
};

/** Explicit operator observations, followed by a separate Human approval. Upload never supplies these. */
export function LocalGenerationReview({ endpoint }: { endpoint: string }) {
  const [model, setModel] = useState<Model | null>(null);
  const [signals, setSignals] = useState<Record<string, "SATISFIED" | "VIOLATED" | "UNCERTAIN">>({});
  const [trackId, setTrackId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [qcPhase, setQcPhase] = useState<"idle" | "saving" | "evaluating" | "done" | "error">("idle");
  const [approvePhase, setApprovePhase] = useState<"idle" | "approving" | "approved" | "error">("idle");
  const [continuityPhase, setContinuityPhase] = useState<"idle" | "preparing" | "extracting" | "ready" | "error">("idle");
  const qcBusy = qcPhase === "saving" || qcPhase === "evaluating";
  const approveBusy = approvePhase === "approving";
  const continuityBusy = continuityPhase === "preparing" || continuityPhase === "extracting";

  async function load() {
    const response = await fetch(endpoint, { method: "GET", cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Review unavailable");
    setModel(body);
    return body as Model;
  }

  useEffect(() => { void load().catch(cause => setError(cause instanceof Error ? cause.message : "Review unavailable")); }, [endpoint]);

  useEffect(() => {
    const audioState = model?.commercialAudio?.assembly?.state;
    if (audioState !== "PENDING" && audioState !== "RUNNING") return;
    const timer = setInterval(() => { void load().catch(() => undefined); }, 3000);
    return () => clearInterval(timer);
  }, [endpoint, model?.commercialAudio?.assembly?.state]);

  async function applyMusic() {
    setError(null);
    try {
      const response = await fetch(endpoint.replace(/\/result$/, "/commercial-audio"), {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(trackId ? { trackId } : {}),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Licensed music could not be queued");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Licensed music could not be queued");
    }
  }

  useEffect(() => {
    const pending = model?.continuityJob?.state === "PENDING" || model?.continuityJob?.state === "RUNNING" || continuityPhase === "extracting";
    if (model?.decision?.decision !== "APPROVED" || model.continuityFrame || !pending) return;
    const timer = setInterval(() => { void load().catch(() => undefined); }, 3000);
    return () => clearInterval(timer);
  }, [endpoint, model?.decision?.decision, model?.continuityFrame, model?.continuityJob?.state, continuityPhase]);

  async function saveQc() {
    if (!model || qcBusy || approveBusy) return;
    setQcPhase("saving");
    setError(null);
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    setQcPhase("evaluating");
    try {
      const observations = visibleOperatorRequirements(model.requirements).map(item => ({
        observationId: crypto.randomUUID(), evidenceVersion: "ai-story-visual-evidence.v1", requirementId: item.requirementId,
        source: "HUMAN_SUPPLIED_EVIDENCE", summary: `Operator inspection: ${item.summary}`,
        observableSignal: signals[item.requirementId] ?? "UNCERTAIN", confidence: { level: "HIGH", score: 1, evidenceQuality: "ADEQUATE" },
        timeRangeMs: null, subjects: [], artifactSeverity: null, subjectiveTasteOnly: false,
      }));
      const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "EVALUATE", observations }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Review could not be saved");
      const next = await load();
      setQcPhase(next.evaluation ? "done" : "error");
    } catch (cause) {
      setQcPhase("error");
      setError(cause instanceof Error ? cause.message : "Review failed");
    }
  }

  async function approve() {
    if (!model || approveBusy || qcBusy) return;
    setApprovePhase("approving");
    setError(null);
    try {
      const response = await fetch(endpoint, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "APPROVE", rationale: "I inspected this exact generated output and approve it after Post-QC." }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Approval could not be saved");
      setApprovePhase("approved");
      await load();
    } catch (cause) {
      setApprovePhase("error");
      setError(cause instanceof Error ? cause.message : "Approval failed");
    }
  }

  async function prepareContinuity() {
    if (continuityBusy || model?.continuityFrame) return;
    setContinuityPhase("preparing");
    setError(null);
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "DERIVE_CONTINUITY" }) });
      if (!response.ok) throw new Error("Continuity extraction unavailable; approved result remains preserved.");
      setContinuityPhase("extracting");
      await load();
    } catch (cause) {
      setContinuityPhase("error");
      setError(cause instanceof Error ? cause.message : "Continuity extraction failed");
    }
  }

  if (!model) return error ? <p role="alert">{error}</p> : <p>Loading generated-output review…</p>;
  const jobState = model.continuityJob?.state ?? null;
  const continuityLabel = continuityStatusLabel({
    frameReady: Boolean(model.continuityFrame),
    jobState,
    phase: continuityPhase,
  });
  const showPrepare = model.decision?.decision === "APPROVED" && !model.continuityFrame && jobState !== "PENDING" && jobState !== "RUNNING" && jobState !== "SUCCEEDED" && continuityPhase !== "preparing" && continuityPhase !== "extracting";

  if (model.decision) return <div className="mt-3 space-y-2 text-sm">
    <p className="font-semibold">Human review: {model.decision.decision}</p>
    {model.decision.decision === "APPROVED" ? <p>Approved ✓</p> : null}
    <p>Continuity frame: {continuityLabel}</p>
    {showPrepare ? <button type="button" className="rounded border px-3 py-2" disabled={continuityBusy} onClick={() => void prepareContinuity()}>Prepare continuity frame</button> : null}
    {error ? <p role="alert" className="text-red-700">{error}</p> : null}
  </div>;

  const requirements = visibleOperatorRequirements(model.requirements);
  const terminal = model.evaluation ? postQcTerminalLabel(model.evaluation.aggregateStatus) : null;
  return <div className="mt-4 space-y-3 rounded-lg border border-border p-3">
    <h4 className="font-semibold">Review local output</h4>
    {model.playbackUrl ? <video controls preload="metadata" className="max-h-96 w-full" src={model.playbackUrl} /> : <p>The exact uploaded media is temporarily unavailable for playback.</p>}
    {model.reviewedMedia === "ASSEMBLED_OUTPUT" ? <p className="text-sm">Playing the assembled commercial video. The original generation stays available underneath.</p> : null}
    {model.sourcePlaybackUrl && model.reviewedMedia === "ASSEMBLED_OUTPUT" ? <video controls preload="metadata" className="max-h-40 w-full" src={model.sourcePlaybackUrl} /> : null}
    {model.commercialAudio && model.commercialAudio.finalPolicy !== "EXPLICIT_SILENCE" && model.commercialAudio.finalPolicy !== "PRESERVE_NATIVE" ? <div className="space-y-2 text-sm">
      <p>Licensed background music. No dialogue is not silence. {model.commercialAudio.assembly?.state === "ASSEMBLED" && model.commercialAudio.assembly.hasAudio ? `Assembled with ${model.commercialAudio.assembly.trackId}.` : "The final video is not reviewable until this mix is ready."}</p>
      {model.commercialAudio.recommendation ? <label>Music
        <select className="ml-2 rounded border p-1" value={trackId || model.commercialAudio.recommendation.trackId} onChange={(event) => setTrackId(event.target.value)}>
          <option value={model.commercialAudio.recommendation.trackId}>{model.commercialAudio.recommendation.name}</option>
          {model.commercialAudio.recommendation.alternatives.map((item) => <option key={item.trackId} value={item.trackId}>{item.name}</option>)}
        </select>
      </label> : <p>No commercially licensed music is available.</p>}
      <button type="button" className="rounded border px-3 py-2" onClick={() => void applyMusic()}>{model.commercialAudio.assembly?.state === "PENDING" || model.commercialAudio.assembly?.state === "RUNNING" ? "Mixing licensed music…" : "Use this licensed music"}</button>
      {model.commercialAudio.blockers.length > 0 ? <p>Speech was not invented. {model.commercialAudio.blockers.join(", ")}</p> : null}
    </div> : null}
    <p className="text-sm">Inspect your exact uploaded video. Technical validation alone does not verify Character, Product or visual continuity.</p>
    {requirements.map(item => <label key={item.requirementId} className="block text-sm">{operatorRequirementLabel(item)}
      <select className="ml-2 rounded border p-1" disabled={qcBusy || approveBusy} value={signals[item.requirementId] ?? "UNCERTAIN"} onChange={event => { const value = event.target.value; if (value === "SATISFIED" || value === "VIOLATED" || value === "UNCERTAIN") setSignals(current => ({ ...current, [item.requirementId]: value })); }}>
        <option value="UNCERTAIN">Not verified</option><option value="SATISFIED">Verified</option><option value="VIOLATED">Requirement violated</option>
      </select></label>)}
    <button type="button" disabled={qcBusy || approveBusy} onClick={() => void saveQc()} className="rounded border px-3 py-2">{qcPhase === "done" && terminal ? terminal : qcActionLabel(qcPhase)}</button>
    {model.evaluation ? <>
      <p>Post-QC: {terminal}</p>
      {model.evaluation.findings.filter(item => item.result !== "PASS").map(item => <p key={item.findingId} className="text-sm">{item.reason}</p>)}
      {model.evaluation.aggregateStatus === "POST_QC_REJECT" ? <p>Local regeneration required. Refresh the packages to download the retry instructions. No cloud fallback is used.</p> : null}
      <button type="button" disabled={approveBusy || qcBusy || !model.evaluation.eligibleForHumanReview || !postQcAllowsHumanApproval(model.evaluation)} onClick={() => void approve()} className="brand-btn-primary">{approveActionLabel(approvePhase)}</button>
    </> : null}
    {error ? <p role="alert" className="text-red-700">{error}</p> : null}
  </div>;
}
