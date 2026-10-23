"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { ExecutionUnitDurationAssessment } from "@ceo-agent/shared";
import {
  PlanningApprovalClientError,
  createPlanningApprovalRequestGate,
} from "@/lib/ai-story-planning-approval-client";

type ApprovalPhase = "idle" | "pending" | "success" | "failure";
type ReadinessFinding = {
  code: string;
  classification: "MISSING_EVIDENCE" | "CONTRADICTION";
  message: string;
  scriptSceneIds: string[];
  sourceAssetId?: string;
};

type PhotoSceneGenerationDto = {
  id: string;
  status: string;
  boundedError?: string | null;
};
type Readiness = {
  status: "PASS" | "BLOCK";
  findings: ReadinessFinding[];
  executionUnitDurations?: ExecutionUnitDurationAssessment;
};

export function PlanningApprovalControl({
  campaignId,
  storyId,
  storyVersionId,
  animationPackageId,
  disabled = false,
  onApproved,
  onError,
}: {
  campaignId: string;
  storyId: string;
  storyVersionId: string | null;
  animationPackageId: string | null;
  disabled?: boolean;
  onApproved: (status: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const gateRef = useRef<ReturnType<typeof createPlanningApprovalRequestGate> | null>(null);
  if (!gateRef.current) gateRef.current = createPlanningApprovalRequestGate();

  const [phase, setPhase] = useState<ApprovalPhase>("idle");
  const [error, setError] = useState("");
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [readinessPending, setReadinessPending] = useState(false);
  const identityReady = Boolean(storyVersionId && animationPackageId);
  const pending = phase === "pending";

  const refreshReadiness = useCallback(async () => {
    if (!identityReady) return;
    setReadinessPending(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${encodeURIComponent(campaignId)}/ai-stories/${encodeURIComponent(storyId)}/planning/readiness?executionEnvironment=LOCAL_GPU`, {
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      const payload = await response.json() as { readiness?: Readiness; error?: string };
      if (!response.ok || !payload.readiness) throw new Error(payload.error ?? "Execution readiness could not be evaluated");
      setReadiness(payload.readiness);
    } catch (caught) {
      setReadiness(null);
      setError(caught instanceof Error ? caught.message : "Execution readiness could not be evaluated");
    } finally {
      setReadinessPending(false);
    }
  }, [campaignId, storyId, identityReady]);

  useEffect(() => { void refreshReadiness(); }, [refreshReadiness]);

  const [preparingAssetId, setPreparingAssetId] = useState<string | null>(null);
  const [prepareError, setPrepareError] = useState("");
  async function prepareProductMaterial(sourceAssetId: string) {
    if (preparingAssetId) return;
    setPreparingAssetId(sourceAssetId);
    setPrepareError("");
    try {
      const startRes = await fetch(`/api/campaigns/${encodeURIComponent(campaignId)}/photo-scene/extractions`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceAssetId }),
      });
      let generation = await startRes.json() as PhotoSceneGenerationDto & { error?: string };
      if (!startRes.ok) throw new Error(generation.error ?? "Product material preparation could not be started");
      const started = Date.now();
      while ((generation.status === "queued" || generation.status === "processing") && Date.now() - started < 5 * 60 * 1000) {
        await new Promise((resolve) => setTimeout(resolve, 2500));
        const pollRes = await fetch(`/api/photo-scene/generations/${encodeURIComponent(generation.id)}`, { credentials: "same-origin" });
        if (!pollRes.ok) break;
        generation = await pollRes.json() as PhotoSceneGenerationDto;
      }
      if (generation.status !== "ready") {
        throw new Error(generation.boundedError ?? "Product material preparation did not complete. Open Photo Scene to check it.");
      }
      await refreshReadiness();
    } catch (caught) {
      setPrepareError(caught instanceof Error ? caught.message : "Product material preparation failed");
    } finally {
      setPreparingAssetId(null);
    }
  }

  const [durationPending, setDurationPending] = useState(false);
  const [durationNotice, setDurationNotice] = useState("");
  async function applyDurationDecision(changes: { sceneId: string; toDurationSec: number }[]) {
    if (durationPending) return;
    setDurationPending(true);
    setError("");
    setDurationNotice("");
    try {
      const response = await fetch(`/api/campaigns/${encodeURIComponent(campaignId)}/ai-stories/${encodeURIComponent(storyId)}/planning/duration-successor`, {
        method: "POST",
        credentials: "same-origin",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ durations: changes.map((change) => ({ sceneId: change.sceneId, durationSec: change.toDurationSec })) }),
      });
      const payload = await response.json() as { error?: string; successorPackageId?: string };
      if (!response.ok) throw new Error(payload.error ?? "Duration successor could not be created");
      setDurationNotice("A successor Planning revision was created. Review it and approve Planning to continue.");
      await refreshReadiness();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Duration successor could not be created");
    } finally {
      setDurationPending(false);
    }
  }

  async function submitApproval(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || phase === "success") return;
    if (!identityReady) {
      const message = "Planning approval identity is unavailable; refresh and try again";
      setPhase("failure");
      setError(message);
      onError(message);
      return;
    }

    setPhase("pending");
    setError("");
    onError("");
    try {
      const result = await gateRef.current!.approve({ campaignId, storyId, executionEnvironment: "LOCAL_GPU" });
      setPhase("success");
      await onApproved(result.status);
    } catch (caught) {
      const failure =
        caught instanceof PlanningApprovalClientError
          ? caught
          : new PlanningApprovalClientError("Planning approval failed");
      console.error("AI Story planning approval failed", {
        code: failure.code,
        name: failure.name,
      });
      setPhase("failure");
      setError(failure.message);
      onError(failure.message);
    }
  }

  return (
    <form onSubmit={submitApproval} data-testid="planning-approval-form" className="space-y-3">
      <label className="block text-sm font-medium text-navy">
        Execution environment
        <select
          value="LOCAL_GPU"
          disabled
          className="mt-1 block w-full rounded-lg border border-border bg-white px-3 py-2 text-sm"
          aria-label="Execution environment"
        >
          <option value="LOCAL_GPU">LOCAL_GPU Desktop</option>
        </select>
      </label>
      <div className="rounded-lg border border-border bg-slate-50 p-3" data-testid="planning-execution-readiness">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-navy">Execution readiness: {readinessPending ? "Checking…" : readiness?.status ?? "Unavailable"}</p>
          <button type="button" onClick={() => void refreshReadiness()} disabled={readinessPending || !identityReady} className="text-xs font-medium text-primary disabled:opacity-60">Re-run validation</button>
        </div>
        {readiness?.findings.length ? (
          <ul className="mt-2 space-y-2 text-sm text-ink-secondary">
            {readiness.findings.map((finding, index) => (
              <li key={`${finding.code}-${finding.scriptSceneIds.join("-") || "plan"}-${index}`} data-testid="planning-readiness-finding">
                <span className="font-medium">{finding.code}</span>
                {" · "}
                <span className="font-medium">{finding.classification === "MISSING_EVIDENCE" ? "Creative decision required" : "Contradiction"}</span>
                {finding.scriptSceneIds.length ? ` · Scene ${finding.scriptSceneIds.join(", ")}` : ""}: {finding.message}
                {finding.code === "PRODUCT_MATERIAL_PREPARATION_REQUIRED" && finding.sourceAssetId ? (
                  <div className="mt-1">
                    <button
                      type="button"
                      onClick={() => void prepareProductMaterial(finding.sourceAssetId!)}
                      disabled={preparingAssetId !== null || readinessPending}
                      className="rounded-lg border border-primary px-3 py-1.5 text-xs font-medium text-primary disabled:opacity-60"
                      data-testid="prepare-product-material"
                    >
                      {preparingAssetId === finding.sourceAssetId ? "Preparing product material…" : "Prepare product material"}
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : readiness?.status === "PASS" ? <p className="mt-2 text-sm text-green-700">Director, Motion, object-state and camera authority are complete and consistent.</p> : null}
        {prepareError ? <p className="mt-2 text-sm text-red-600" role="alert">{prepareError}</p> : null}
        {readiness?.executionUnitDurations && readiness.executionUnitDurations.status !== "COMPLIANT" ? (
          <div className="mt-3 space-y-2 text-sm text-ink-secondary" data-testid="planning-execution-units">
            <p className="font-medium text-navy">
              Generation units (certified {readiness.executionUnitDurations.minSec}–{readiness.executionUnitDurations.maxSec}s, Episode {readiness.executionUnitDurations.episodeDurationSec}s)
            </p>
            <ul className="space-y-1">
              {readiness.executionUnitDurations.units.map((unit) => (
                <li key={unit.sceneId} data-testid="planning-execution-unit">
                  {unit.sceneId} · {unit.durationSec}s · {unit.certified ? "certified" : "outside range"}
                </li>
              ))}
            </ul>
            {readiness.executionUnitDurations.decision ? (
              <div className="space-y-2" data-testid="planning-execution-unit-decision">
                <p data-testid="planning-execution-unit-option">
                  {`Change Scene durations (Episode ${readiness.executionUnitDurations.decision.option.episodeDurationSec}s): ${readiness.executionUnitDurations.decision.option.creativeChanges.join("; ")}`}
                </p>
                <button
                  type="button"
                  onClick={() => void applyDurationDecision(readiness.executionUnitDurations!.decision!.option.changes)}
                  disabled={disabled || durationPending || readinessPending}
                  aria-busy={durationPending}
                  className="rounded-lg border border-primary px-3 py-1.5 text-xs font-medium text-primary disabled:opacity-60"
                >
                  Create duration successor for review
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
        {durationNotice ? <p className="mt-2 text-sm text-green-700" data-testid="planning-duration-successor-notice">{durationNotice}</p> : null}
      </div>
      <button
        type="submit"
        disabled={disabled || pending || phase === "success" || !identityReady || readinessPending || readiness?.status !== "PASS"}
        aria-busy={pending}
        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? "Approving…" : phase === "success" ? "Approved" : "Approve Planning"}
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {pending
          ? "Planning approval request in progress"
          : phase === "success"
            ? "Planning approved"
            : ""}
      </span>
      {error ? (
        <p className="mt-2 text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
