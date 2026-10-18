"use client";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/provider";
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
  buildLooksGoodObservation,
  categoryLabelKey,
  formatChangeSummary,
  formatReviewClock,
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
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [model, setModel] = useState<Model | null>(null);
  const [signals, setSignals] = useState<Record<string, ReviewSignal | undefined>>({});
  const [trackId, setTrackId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mode, setMode] = useState<"watch" | "changes">("watch");
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
    setSummary(formatChangeSummary({
      category,
      startSec,
      endSec,
      explanation,
      categoryLabel: t(categoryLabelKey(category)),
      sentence: (label, range) => t("review.changeLead", { category: label, range }),
    }));
  }, [category, startSec, endSec, explanation, summaryTouched, t]);

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

  async function looksGood() {
    if (!model || approveBusy || qcBusy) return;
    const current = looksGoodDecision({ evaluation: model.evaluation });
    if (current.action === "explain") {
      setError(current.message);
      return;
    }
    setApprovePhase("approving");
    setError(null);
    try {
      const recorded = await postReview({ action: "EVALUATE", observations: [buildLooksGoodObservation(crypto.randomUUID())] }, t("review.error.save"));
      const evaluation = recorded.evaluation ?? null;
      const decision = looksGoodDecision({ evaluation });
      if (decision.action === "explain" || !evaluation?.eligibleForHumanReview) {
        setApprovePhase("error");
        setError(decision.action === "explain" ? decision.message : t("review.error.technical"));
        await load();
        return;
      }
      await postReview({ action: "APPROVE", rationale: "I watched this video and it looks good." }, t("review.error.save"));
      setApprovePhase("approved");
      await load();
    } catch (cause) {
      setApprovePhase("error");
      setError(cause instanceof Error ? cause.message : t("review.error.save"));
    }
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
      setNotice(built.limitation ?? t("review.changeSaved"));
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

  if (!model) return error ? <p role="alert">{error}</p> : <p>{t("review.loading")}</p>;
  const jobState = model.continuityJob?.state ?? null;
  const continuityLabel = continuityStatusLabel({
    frameReady: Boolean(model.continuityFrame),
    jobState,
    phase: continuityPhase,
  });
  const showPrepare = model.decision?.decision === "APPROVED" && !model.continuityFrame && jobState !== "PENDING" && jobState !== "RUNNING" && jobState !== "SUCCEEDED" && continuityPhase !== "preparing" && continuityPhase !== "extracting";
  const requirements = visibleOperatorRequirements(model.requirements);
  const progress = sceneIndex && sceneTotal ? t("review.scene", { index: sceneIndex, total: sceneTotal }) : sceneProgressLabel(0, 0);
  const musicPending = model.commercialAudio && model.commercialAudio.finalPolicy !== "EXPLICIT_SILENCE" && model.commercialAudio.finalPolicy !== "PRESERVE_NATIVE";
  const musicReady = model.commercialAudio?.assembly?.state === "ASSEMBLED" && model.commercialAudio.assembly.hasAudio;
  const acceptance = looksGoodDecision({ evaluation: model.evaluation });
  const terminal = model.evaluation ? postQcTerminalLabel(model.evaluation.aggregateStatus) : null;
  const duration = durationSec ?? 0;

  return <section className="mt-4 w-full min-w-0 max-w-full space-y-4 overflow-x-hidden rounded-xl border border-border bg-white p-4" data-testid="simple-video-review">
    <div>
      <h4 className="text-lg font-semibold text-navy">{t("review.title")}</h4>
      {sceneIndex && sceneTotal ? <p className="text-sm text-ink-secondary">{progress}</p> : null}
    </div>
    {model.playbackUrl
      ? <video
          ref={videoRef}
          controls
          playsInline
          preload="metadata"
          className="aspect-video max-h-[70vh] w-full rounded-lg bg-black"
          src={model.playbackUrl}
          aria-label={t("review.videoLabel")}
          onLoadedMetadata={(event) => {
            const next = event.currentTarget.duration;
            if (!Number.isFinite(next)) return;
            setDurationSec(next);
            setEndSec((current) => current > 0 ? current : next);
          }}
        />
      : <p>{t("review.unavailable")}</p>}
    {model.decision ? <div className="space-y-2 text-sm">
      <p className="font-semibold">Human review: {model.decision.decision}</p>
      {model.decision.decision === "APPROVED" ? <p>{t("review.completed")}</p> : <p>{t("review.notAccepted")}</p>}
      <p>Continuity frame: {continuityLabel}</p>
      {showPrepare ? <button type="button" className="min-h-11 rounded border px-3 py-2" disabled={continuityBusy} onClick={() => void prepareContinuity()}>Prepare the next scene</button> : null}
    </div> : <>
      <p className="text-sm text-ink-secondary">{t("review.watch")}</p>
      {musicPending ? <div className="space-y-2 text-sm">
        <p>{musicReady ? t("review.musicIncluded") : t("review.musicNeeded")}</p>
        {model.commercialAudio?.recommendation ? <label className="block">Music
          <select className="mt-1 w-full max-w-full rounded border p-2" aria-label={t("review.musicLabel")} value={trackId || model.commercialAudio.recommendation.trackId} onChange={(event) => setTrackId(event.target.value)}>
            <option value={model.commercialAudio.recommendation.trackId}>{model.commercialAudio.recommendation.name}</option>
            {model.commercialAudio.recommendation.alternatives.map((item) => <option key={item.trackId} value={item.trackId}>{item.name}</option>)}
          </select>
        </label> : <p>{t("review.musicNone")}</p>}
        <button type="button" className="min-h-11 rounded border px-3 py-2" onClick={() => void applyMusic()}>{model.commercialAudio?.assembly?.state === "PENDING" || model.commercialAudio?.assembly?.state === "RUNNING" ? t("review.musicAdding") : t("review.musicUse")}</button>
      </div> : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button type="button" className="brand-btn-primary min-h-11 w-full" disabled={approveBusy || qcBusy} onClick={() => void looksGood()}>{approveBusy ? t("review.saving") : t("review.looksGood")}</button>
        <button type="button" className="brand-btn-secondary min-h-11 w-full" disabled={qcBusy || approveBusy} onClick={() => { setMode("changes"); setError(null); }}>{t("review.needsChanges")}</button>
      </div>
      {mode === "changes" ? <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void submitChanges(); }}>
        <p className="text-sm font-semibold">{t("review.changeTitle")}</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-sm">{t("review.startsAt", { time: formatReviewClock(startSec) })}
            <input className="mt-1 w-full" type="range" min={0} max={duration || 0} step={0.1} value={Math.min(startSec, duration || startSec)} aria-label={t("review.startsAt", { time: formatReviewClock(startSec) })} onChange={(event) => { setStartSec(Number(event.target.value)); setSummaryTouched(false); }} />
          </label>
          <label className="text-sm">{t("review.endsAt", { time: formatReviewClock(endSec) })}
            <input className="mt-1 w-full" type="range" min={0} max={duration || 0} step={0.1} value={Math.min(endSec, duration || endSec)} aria-label={t("review.endsAt", { time: formatReviewClock(endSec) })} onChange={(event) => { setEndSec(Number(event.target.value)); setSummaryTouched(false); }} />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="min-h-11 rounded border px-3 py-2 text-sm" onClick={() => markTime("start")}>{t("review.useStart")}</button>
          <button type="button" className="min-h-11 rounded border px-3 py-2 text-sm" onClick={() => markTime("end")}>{t("review.useEnd")}</button>
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold">{t("review.problemType")}</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {VIDEO_REVIEW_ISSUE_CATEGORIES.map((item) => <label key={item.id} className="flex min-h-11 items-center gap-2 rounded border px-2 text-sm">
              <input type="radio" name="problem-type" value={item.id} checked={category === item.id} onChange={() => { setCategory(item.id); setSummaryTouched(false); }} />
              {t(categoryLabelKey(item.id))}
            </label>)}
          </div>
        </fieldset>
        <label className="block text-sm">{t("review.explanation")}
          <textarea className="mt-1 w-full rounded border p-2" rows={3} maxLength={2000} value={explanation} onChange={(event) => { setExplanation(event.target.value); setSummaryTouched(false); }} />
        </label>
        <label className="block text-sm">{t("review.summary")}
          <textarea className="mt-1 w-full rounded border p-2" rows={3} maxLength={3000} value={summary} aria-label={t("review.summary")} onChange={(event) => { setSummary(event.target.value); setSummaryTouched(true); }} />
        </label>
        <p className="text-sm text-ink-secondary">{t("review.summaryHint")}</p>
        <button type="submit" className="brand-btn-primary min-h-11 w-full sm:w-auto" disabled={qcBusy || approveBusy}>{qcBusy ? t("review.saving") : t("review.submit")}</button>
      </form> : null}
    </>}
    {notice ? <p className="text-sm">{notice}</p> : null}
    {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
    <details className="text-sm">
      <summary className="cursor-pointer font-semibold">{t("review.support")}</summary>
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
