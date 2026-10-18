"use client";
import { useEffect, useRef, useState } from "react";
import { postQcAllowsHumanApproval, type AiStoryPostGenerationQcEvaluation, type AiStoryPostQcRequirement } from "@ceo-agent/shared";
import {
  approveActionLabel,
  continuityStatusLabel,
  operatorRequirementLabel,
  postQcTerminalLabel,
  qcActionLabel,
  visibleOperatorRequirements,
} from "./local-generation-operator-feedback";
import {
  VIDEO_REVIEW_ISSUE_CATEGORIES,
  buildChangeObservation,
  explicitCheckObservations,
  formatChangeSummary,
  formatReviewClock,
  issueCategoryLabel,
  looksGoodDecision,
  plainRequirementLabel,
  plainReviewError,
  plainReviewMessage,
  sceneProgressLabel,
  type ReviewSignal,
  type VideoReviewIssueCategory,
} from "./simple-video-review";

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

/** The same review surface for manual review and a future auto-production result. */
export function LocalGenerationReview({
  endpoint,
  sceneIndex,
  sceneTotal,
}: {
  endpoint: string;
  sceneIndex?: number;
  sceneTotal?: number;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [model, setModel] = useState<Model | null>(null);
  const [signals, setSignals] = useState<Record<string, ReviewSignal | undefined>>({});
  const [trackId, setTrackId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mode, setMode] = useState<"watch" | "changes" | "confirm">("watch");
  const [category, setCategory] = useState<VideoReviewIssueCategory>("product");
  const [startSec, setStartSec] = useState(0);
  const [endSec, setEndSec] = useState(0);
  const [explanation, setExplanation] = useState("");
  const [summary, setSummary] = useState("");
  const [summaryTouched, setSummaryTouched] = useState(false);
  const [durationSec, setDurationSec] = useState<number | null>(null);
  const [qcPhase, setQcPhase] = useState<"idle" | "saving" | "evaluating" | "done" | "error">("idle");
  const [approvePhase, setApprovePhase] = useState<"idle" | "approving" | "approved" | "error">("idle");
  const [continuityPhase, setContinuityPhase] = useState<"idle" | "preparing" | "extracting" | "ready" | "error">("idle");
  const qcBusy = qcPhase === "saving" || qcPhase === "evaluating";
  const approveBusy = approvePhase === "approving";
  const continuityBusy = continuityPhase === "preparing" || continuityPhase === "extracting";

  async function load() {
    const response = await fetch(endpoint, { method: "GET", cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(plainReviewError(body.code, body.error ?? "This review is unavailable right now."));
    setModel(body);
    return body as Model;
  }

  useEffect(() => { void load().catch(cause => setError(cause instanceof Error ? cause.message : "This review is unavailable right now.")); }, [endpoint]);

  useEffect(() => {
    const audioState = model?.commercialAudio?.assembly?.state;
    if (audioState !== "PENDING" && audioState !== "RUNNING") return;
    const timer = setInterval(() => { void load().catch(() => undefined); }, 3000);
    return () => clearInterval(timer);
  }, [endpoint, model?.commercialAudio?.assembly?.state]);

  useEffect(() => {
    if (summaryTouched) return;
    setSummary(formatChangeSummary({ category, startSec, endSec, explanation }));
  }, [category, startSec, endSec, explanation, summaryTouched]);

  async function applyMusic() {
    setError(null);
    try {
      const response = await fetch(endpoint.replace(/\/result$/, "/commercial-audio"), {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(trackId ? { trackId } : {}),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(plainReviewError(body.code, body.error ?? "The music could not be added."));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The music could not be added.");
    }
  }

  useEffect(() => {
    const pending = model?.continuityJob?.state === "PENDING" || model?.continuityJob?.state === "RUNNING" || continuityPhase === "extracting";
    if (model?.decision?.decision !== "APPROVED" || model.continuityFrame || !pending) return;
    const timer = setInterval(() => { void load().catch(() => undefined); }, 3000);
    return () => clearInterval(timer);
  }, [endpoint, model?.decision?.decision, model?.continuityFrame, model?.continuityJob?.state, continuityPhase]);

  async function postReview(body: unknown, fallback: string) {
    const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json();
    if (!response.ok) throw new Error(plainReviewError(payload.code, payload.error ?? fallback));
    return payload;
  }

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
      await postReview({ action: "EVALUATE", observations }, "The check could not be saved.");
      const next = await load();
      setQcPhase(next.evaluation ? "done" : "error");
    } catch (cause) {
      setQcPhase("error");
      setError(cause instanceof Error ? cause.message : "The check could not be saved.");
    }
  }

  async function saveConfirmedChecks() {
    if (!model || qcBusy || approveBusy) return;
    const observations = explicitCheckObservations({
      requirements: model.requirements,
      signals,
      observationIdFor: () => crypto.randomUUID(),
    });
    if (observations.length === 0) {
      setError("Choose what you see for at least one item. Items you skip stay unconfirmed.");
      return;
    }
    setQcPhase("saving");
    setError(null);
    setQcPhase("evaluating");
    try {
      await postReview({ action: "EVALUATE", observations }, "The check could not be saved.");
      await load();
      setQcPhase("done");
      setNotice("Your checks are saved. If everything you confirmed is complete, you can choose Looks Good.");
    } catch (cause) {
      setQcPhase("error");
      setError(cause instanceof Error ? cause.message : "The check could not be saved.");
    }
  }

  async function approve() {
    if (!model || approveBusy || qcBusy) return;
    setApprovePhase("approving");
    setError(null);
    try {
      await postReview({ action: "APPROVE", rationale: "I watched this video and it looks good." }, "This video could not be accepted.");
      setApprovePhase("approved");
      await load();
    } catch (cause) {
      setApprovePhase("error");
      setError(cause instanceof Error ? cause.message : "This video could not be accepted.");
    }
  }

  function looksGood() {
    if (!model || approveBusy || qcBusy) return;
    const decision = looksGoodDecision({ evaluation: model.evaluation, requirements: model.requirements });
    if (decision.action === "explain") {
      setMode("confirm");
      setNotice(null);
      setError(decision.message);
      return;
    }
    void approve();
  }

  async function submitChanges() {
    if (!model || qcBusy || approveBusy) return;
    const built = buildChangeObservation({
      observationId: crypto.randomUUID(),
      requirements: model.requirements,
      category,
      startSec,
      endSec,
      summary,
      durationSec,
    });
    if ("error" in built) {
      setError(built.error);
      return;
    }
    setQcPhase("saving");
    setError(null);
    setNotice(built.limitation);
    setQcPhase("evaluating");
    try {
      await postReview({ action: "EVALUATE", observations: [built.observation] }, "The change request could not be saved.");
      await load();
      setQcPhase("done");
      setMode("watch");
      setNotice(built.limitation ?? "Your change request is saved. This video was not accepted, and nothing new was generated.");
    } catch (cause) {
      setQcPhase("error");
      setError(cause instanceof Error ? cause.message : "The change request could not be saved.");
    }
  }

  function markTime(which: "start" | "end") {
    const time = videoRef.current?.currentTime;
    if (typeof time !== "number" || !Number.isFinite(time)) return;
    if (which === "start") setStartSec(time);
    else setEndSec(time);
    setSummaryTouched(false);
  }

  async function prepareContinuity() {
    if (continuityBusy || model?.continuityFrame) return;
    setContinuityPhase("preparing");
    setError(null);
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "DERIVE_CONTINUITY" }) });
      if (!response.ok) throw new Error("The next scene could not be prepared. The accepted video is still saved.");
      setContinuityPhase("extracting");
      await load();
    } catch (cause) {
      setContinuityPhase("error");
      setError(cause instanceof Error ? cause.message : "The next scene could not be prepared.");
    }
  }

  if (!model) return error ? <p role="alert">{error}</p> : <p>Loading the video…</p>;
  const jobState = model.continuityJob?.state ?? null;
  const continuityLabel = continuityStatusLabel({
    frameReady: Boolean(model.continuityFrame),
    jobState,
    phase: continuityPhase,
  });
  const showPrepare = model.decision?.decision === "APPROVED" && !model.continuityFrame && jobState !== "PENDING" && jobState !== "RUNNING" && jobState !== "SUCCEEDED" && continuityPhase !== "preparing" && continuityPhase !== "extracting";
  const requirements = visibleOperatorRequirements(model.requirements);
  const progress = sceneIndex && sceneTotal ? sceneProgressLabel(sceneIndex, sceneTotal) : null;
  const musicPending = model.commercialAudio && model.commercialAudio.finalPolicy !== "EXPLICIT_SILENCE" && model.commercialAudio.finalPolicy !== "PRESERVE_NATIVE";
  const musicReady = model.commercialAudio?.assembly?.state === "ASSEMBLED" && model.commercialAudio.assembly.hasAudio;
  const acceptance = looksGoodDecision({ evaluation: model.evaluation, requirements: model.requirements });
  const terminal = model.evaluation ? postQcTerminalLabel(model.evaluation.aggregateStatus) : null;
  const duration = durationSec ?? 0;

  return <section className="mt-4 w-full min-w-0 max-w-full space-y-4 overflow-x-hidden rounded-xl border border-border bg-white p-4" data-testid="simple-video-review">
    <div>
      <h4 className="text-lg font-semibold text-navy">Review this video</h4>
      {progress ? <p className="text-sm text-ink-secondary">{progress}</p> : null}
    </div>
    {model.playbackUrl
      ? <video
          ref={videoRef}
          controls
          playsInline
          preload="metadata"
          className="aspect-video max-h-[70vh] w-full rounded-lg bg-black"
          src={model.playbackUrl}
          aria-label="Generated video"
          onLoadedMetadata={(event) => {
            const next = event.currentTarget.duration;
            if (!Number.isFinite(next)) return;
            setDurationSec(next);
            setEndSec((current) => current > 0 ? current : next);
          }}
        />
      : <p>The video is temporarily unavailable. Reload the page and try again.</p>}
    {model.decision ? <div className="space-y-2 text-sm">
      <p className="font-semibold">Human review: {model.decision.decision}</p>
      {model.decision.decision === "APPROVED" ? <p>This video is accepted.</p> : <p>This video was not accepted.</p>}
      <p>Continuity frame: {continuityLabel}</p>
      {showPrepare ? <button type="button" className="min-h-11 rounded border px-3 py-2" disabled={continuityBusy} onClick={() => void prepareContinuity()}>Prepare the next scene</button> : null}
    </div> : <>
      <p className="text-sm text-ink-secondary">Watch the video, then choose one option.</p>
      {musicPending ? <div className="space-y-2 text-sm">
        <p>{musicReady ? `Music is included${model.commercialAudio?.assembly?.trackId ? `: ${model.commercialAudio.assembly.trackId}` : ""}.` : "This video needs background music before it can be accepted."}</p>
        {model.commercialAudio?.recommendation ? <label className="block">Music
          <select className="mt-1 w-full max-w-full rounded border p-2" aria-label="Background music" value={trackId || model.commercialAudio.recommendation.trackId} onChange={(event) => setTrackId(event.target.value)}>
            <option value={model.commercialAudio.recommendation.trackId}>{model.commercialAudio.recommendation.name}</option>
            {model.commercialAudio.recommendation.alternatives.map((item) => <option key={item.trackId} value={item.trackId}>{item.name}</option>)}
          </select>
        </label> : <p>No licensed music is available yet.</p>}
        <button type="button" className="min-h-11 rounded border px-3 py-2" onClick={() => void applyMusic()}>{model.commercialAudio?.assembly?.state === "PENDING" || model.commercialAudio?.assembly?.state === "RUNNING" ? "Adding music…" : "Use this music"}</button>
      </div> : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button type="button" className="brand-btn-primary min-h-11 w-full" disabled={approveBusy || qcBusy} onClick={looksGood}>{approveBusy ? "Saving…" : "Looks Good"}</button>
        <button type="button" className="brand-btn-secondary min-h-11 w-full" disabled={qcBusy || approveBusy} onClick={() => { setMode("changes"); setError(null); }}>Needs Changes</button>
      </div>
      {mode === "changes" ? <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void submitChanges(); }}>
        <p className="text-sm font-semibold">What should change?</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-sm">Starts at {formatReviewClock(startSec)}
            <input className="mt-1 w-full" type="range" min={0} max={duration || 0} step={0.1} value={Math.min(startSec, duration || startSec)} aria-label="Problem starts at" onChange={(event) => { setStartSec(Number(event.target.value)); setSummaryTouched(false); }} />
          </label>
          <label className="text-sm">Ends at {formatReviewClock(endSec)}
            <input className="mt-1 w-full" type="range" min={0} max={duration || 0} step={0.1} value={Math.min(endSec, duration || endSec)} aria-label="Problem ends at" onChange={(event) => { setEndSec(Number(event.target.value)); setSummaryTouched(false); }} />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="min-h-11 rounded border px-3 py-2 text-sm" onClick={() => markTime("start")}>Use current time as start</button>
          <button type="button" className="min-h-11 rounded border px-3 py-2 text-sm" onClick={() => markTime("end")}>Use current time as end</button>
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold">Problem type</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {VIDEO_REVIEW_ISSUE_CATEGORIES.map((item) => <label key={item.id} className="flex min-h-11 items-center gap-2 rounded border px-2 text-sm">
              <input type="radio" name="problem-type" value={item.id} checked={category === item.id} onChange={() => { setCategory(item.id); setSummaryTouched(false); }} />
              {item.label}
            </label>)}
          </div>
        </fieldset>
        <label className="block text-sm">Explanation, optional
          <textarea className="mt-1 w-full rounded border p-2" rows={3} maxLength={2000} value={explanation} onChange={(event) => { setExplanation(event.target.value); setSummaryTouched(false); }} />
        </label>
        <label className="block text-sm">Summary
          <textarea className="mt-1 w-full rounded border p-2" rows={3} maxLength={3000} value={summary} aria-label="Change summary" onChange={(event) => { setSummary(event.target.value); setSummaryTouched(true); }} />
        </label>
        <p className="text-sm text-ink-secondary">{issueCategoryLabel(category)} from {formatReviewClock(startSec)} to {formatReviewClock(endSec)}. You can edit the summary before submitting.</p>
        <button type="submit" className="brand-btn-primary min-h-11 w-full sm:w-auto" disabled={qcBusy || approveBusy}>{qcBusy ? "Saving…" : "Submit changes"}</button>
      </form> : null}
      {mode === "confirm" ? <div className="space-y-3">
        <p className="text-sm font-semibold">Confirm only what you see</p>
        {requirements.map((item) => <div key={item.requirementId} className="space-y-2 rounded border p-3">
          <p className="text-sm">{plainRequirementLabel(item)}</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button type="button" className="min-h-11 rounded border px-3 py-2 text-sm" aria-pressed={signals[item.requirementId] === "SATISFIED"} onClick={() => setSignals((current) => ({ ...current, [item.requirementId]: "SATISFIED" }))}>Looks right</button>
            <button type="button" className="min-h-11 rounded border px-3 py-2 text-sm" aria-pressed={signals[item.requirementId] === "VIOLATED"} onClick={() => setSignals((current) => ({ ...current, [item.requirementId]: "VIOLATED" }))}>Not right</button>
          </div>
        </div>)}
        <button type="button" className="brand-btn-primary min-h-11" disabled={qcBusy || approveBusy} onClick={() => void saveConfirmedChecks()}>{qcBusy ? "Saving…" : "Save what I checked"}</button>
      </div> : null}
    </>}
    {notice ? <p className="text-sm">{notice}</p> : null}
    {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
    <details className="text-sm">
      <summary className="cursor-pointer font-semibold">Support details</summary>
      <div className="mt-3 space-y-3">
        <p>These details are for support. They do not accept the video by themselves.</p>
        {model.reviewedMedia === "ASSEMBLED_OUTPUT" ? <p>The main player shows the video with music. The original video is below.</p> : null}
        {model.sourcePlaybackUrl && model.reviewedMedia === "ASSEMBLED_OUTPUT" ? <video controls playsInline preload="metadata" className="max-h-40 w-full" src={model.sourcePlaybackUrl} aria-label="Original video without the music mix" /> : null}
        <p>Support reference: {model.generationResultId}</p>
        {requirements.map(item => <label key={item.requirementId} className="block">{operatorRequirementLabel(item)}
          <select className="mt-1 w-full max-w-full rounded border p-2" aria-label={plainRequirementLabel(item)} disabled={qcBusy || approveBusy} value={signals[item.requirementId] ?? "UNCERTAIN"} onChange={event => { const value = event.target.value; if (value === "SATISFIED" || value === "VIOLATED") setSignals(current => ({ ...current, [item.requirementId]: value })); else setSignals(current => ({ ...current, [item.requirementId]: undefined })); }}>
            <option value="UNCERTAIN">Not confirmed</option><option value="SATISFIED">Looks right</option><option value="VIOLATED">Not right</option>
          </select></label>)}
        <button type="button" disabled={qcBusy || approveBusy} onClick={() => void saveQc()} className="min-h-11 rounded border px-3 py-2">{qcPhase === "done" && terminal ? terminal : qcActionLabel(qcPhase)}</button>
        {model.evaluation ? <>
          <p>Saved check: {terminal}</p>
          {model.evaluation.findings.filter(item => item.result !== "PASS").map(item => <p key={item.findingId}>{plainReviewMessage(item.reason)}</p>)}
          {model.evaluation.aggregateStatus === "POST_QC_REJECT" ? <p>This video needs a new version before it can be accepted.</p> : null}
          {!model.decision ? <button type="button" disabled={approveBusy || qcBusy || acceptance.action !== "approve" || !model.evaluation.eligibleForHumanReview || !postQcAllowsHumanApproval(model.evaluation)} onClick={() => void approve()} className="min-h-11 rounded border px-3 py-2">{approveActionLabel(approvePhase)}</button> : null}
        </> : <p>No saved check yet.</p>}
      </div>
    </details>
  </section>;
}
