"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
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
};
type Readiness = {
  status: "PASS" | "BLOCK";
  findings: ReadinessFinding[];
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
              <li key={`${finding.code}-${finding.scriptSceneIds.join("-") || "plan"}-${index}`}>
                <span className="font-medium">{finding.classification === "MISSING_EVIDENCE" ? "Creative decision required" : "Contradiction"}</span>
                {finding.scriptSceneIds.length ? ` · Scene ${finding.scriptSceneIds.join(", ")}` : ""}: {finding.message}
              </li>
            ))}
          </ul>
        ) : readiness?.status === "PASS" ? <p className="mt-2 text-sm text-green-700">Director, Motion, object-state and camera authority are complete and consistent.</p> : null}
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
