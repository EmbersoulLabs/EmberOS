"use client";

import { useRef, useState, type FormEvent } from "react";
import {
  PlanningApprovalClientError,
  createPlanningApprovalRequestGate,
} from "@/lib/ai-story-planning-approval-client";

type ApprovalPhase = "idle" | "pending" | "success" | "failure";

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
  const identityReady = Boolean(storyVersionId && animationPackageId);
  const pending = phase === "pending";

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
      const result = await gateRef.current!.approve({ campaignId, storyId });
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
    <form onSubmit={submitApproval} data-testid="planning-approval-form">
      <button
        type="submit"
        disabled={disabled || pending || phase === "success" || !identityReady}
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
