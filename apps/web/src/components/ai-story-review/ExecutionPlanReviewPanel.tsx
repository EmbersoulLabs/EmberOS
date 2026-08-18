"use client";

/**
 * Sprint 3 Phase 2B PR 2B.5 — Human Review & Assembly Definition UI.
 * Consumes only approved PR 2B.4 APIs. Execution remains FAIL CLOSED.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ExecutionPlanReviewAssemblyReadModel,
  HumanReviewDecision,
  ReviewHistoryReadModel,
  WorkspaceRole,
} from "@ceo-agent/shared";
import { PHASE1_EXECUTION_LOCKED } from "@ceo-agent/shared";
import {
  ReviewAssemblyClientError,
  getReviewHistory,
  getReviewReadModel,
  openReview,
  postAssemblyDefinition,
  postSceneDecision,
  postStoryDecision,
} from "@/lib/ai-story-review-assembly-client";
import {
  canMutateReviewAssembly,
  formatExecutionLockLabel,
  formatExecutionReadiness,
  formatReviewStatus,
  isAssemblyCreateAvailable,
  isStoryApproveEligible,
  reviewAssemblyErrorMessage,
  shortenId,
} from "@/lib/ai-story-review-assembly-ui";

type Props = {
  campaignId: string;
  storyId: string;
  executionPlanId: string;
  storyTitle?: string;
  storyVersionId?: string | null;
  animationPackageId?: string | null;
  compilationHash?: string | null;
  workspaceRole: WorkspaceRole | string | null;
  sceneIntentHints?: ReadonlyArray<{
    sceneExecutionId: string;
    sceneId?: string;
    sceneOrder?: number;
    purpose?: string;
    plannedDurationMs?: number;
    shotCount?: number;
    referencedAssetIds?: string[];
  }>;
};

type PendingAction =
  | null
  | "open"
  | "reload"
  | "history"
  | "assembly"
  | `scene:${string}:${HumanReviewDecision}`
  | `story:${HumanReviewDecision}`;

export function ExecutionPlanReviewPanel({
  campaignId,
  storyId,
  executionPlanId,
  storyTitle,
  storyVersionId,
  animationPackageId,
  compilationHash,
  workspaceRole,
  sceneIntentHints = [],
}: Props) {
  const canMutate = canMutateReviewAssembly(workspaceRole);
  const [model, setModel] = useState<ExecutionPlanReviewAssemblyReadModel | null>(null);
  const [history, setHistory] = useState<ReviewHistoryReadModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<PendingAction>(null);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [sceneComments, setSceneComments] = useState<Record<string, string>>({});
  const [storyComment, setStoryComment] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const requestGen = useRef(0);

  const hintByScene = new Map(
    sceneIntentHints.map((h) => [h.sceneExecutionId, h] as const)
  );

  const applyError = useCallback((err: unknown) => {
    if (err instanceof ReviewAssemblyClientError) {
      setError({
        message: reviewAssemblyErrorMessage(err.code, err.message),
        code: err.code,
      });
      return;
    }
    setError({
      message: err instanceof Error ? err.message : "Request failed",
    });
  }, []);

  const reloadCanonical = useCallback(
    async (mode: "initial" | "reload" = "reload") => {
      const gen = ++requestGen.current;
      if (mode === "initial") setLoading(true);
      else setPending("reload");
      setError(null);
      try {
        const next = await getReviewReadModel({ campaignId, storyId, executionPlanId });
        if (gen !== requestGen.current) return;
        setModel(next);
        try {
          const hist = await getReviewHistory({ campaignId, storyId, executionPlanId });
          if (gen !== requestGen.current) return;
          setHistory(hist);
        } catch {
          // History may 404 before open; ignore on load.
          if (gen === requestGen.current) setHistory(null);
        }
      } catch (err) {
        if (gen !== requestGen.current) return;
        if (err instanceof ReviewAssemblyClientError && err.status === 404) {
          setModel(null);
          setHistory(null);
        } else {
          applyError(err);
        }
      } finally {
        if (gen === requestGen.current) {
          setLoading(false);
          setPending(null);
        }
      }
    },
    [applyError, campaignId, executionPlanId, storyId]
  );

  useEffect(() => {
    void reloadCanonical("initial");
  }, [reloadCanonical]);

  async function handleOpenReview() {
    if (!canMutate || pending) return;
    const gen = ++requestGen.current;
    setPending("open");
    setError(null);
    try {
      const opened = await openReview({ campaignId, storyId, executionPlanId });
      if (gen !== requestGen.current) return;
      setModel(opened);
      const hist = await getReviewHistory({ campaignId, storyId, executionPlanId });
      if (gen !== requestGen.current) return;
      setHistory(hist);
    } catch (err) {
      if (gen !== requestGen.current) return;
      applyError(err);
    } finally {
      if (gen === requestGen.current) setPending(null);
    }
  }

  async function handleSceneDecision(
    sceneExecutionId: string,
    decision: HumanReviewDecision
  ) {
    if (!canMutate || pending) return;
    const gen = ++requestGen.current;
    setPending(`scene:${sceneExecutionId}:${decision}`);
    setError(null);
    try {
      await postSceneDecision({
        campaignId,
        storyId,
        executionPlanId,
        sceneExecutionId,
        decision,
        comment: sceneComments[sceneExecutionId],
      });
      if (gen !== requestGen.current) return;
      await reloadCanonical("reload");
    } catch (err) {
      if (gen !== requestGen.current) return;
      applyError(err);
      setPending(null);
    }
  }

  async function handleStoryDecision(decision: HumanReviewDecision) {
    if (!canMutate || pending) return;
    const gen = ++requestGen.current;
    setPending(`story:${decision}`);
    setError(null);
    try {
      await postStoryDecision({
        campaignId,
        storyId,
        executionPlanId,
        decision,
        comment: storyComment,
      });
      if (gen !== requestGen.current) return;
      await reloadCanonical("reload");
    } catch (err) {
      if (gen !== requestGen.current) return;
      applyError(err);
      setPending(null);
    }
  }

  async function handleCreateAssembly() {
    if (!canMutate || pending) return;
    const gen = ++requestGen.current;
    setPending("assembly");
    setError(null);
    try {
      await postAssemblyDefinition({ campaignId, storyId, executionPlanId });
      if (gen !== requestGen.current) return;
      await reloadCanonical("reload");
    } catch (err) {
      if (gen !== requestGen.current) return;
      applyError(err);
      setPending(null);
    }
  }

  const reviewOpened = Boolean(model?.review.openedAt);
  const terminalRejected = model?.review.status === "REJECTED";
  const storyEligible = isStoryApproveEligible(model);
  const assemblyAvailable = isAssemblyCreateAvailable(model);
  const busy = pending != null;

  return (
    <section
      className="space-y-5 rounded-2xl border border-border bg-white p-5"
      data-testid="execution-plan-review-panel"
      data-execution-allowed="false"
      data-execution-lock={PHASE1_EXECUTION_LOCKED}
      data-can-mutate={canMutate ? "true" : "false"}
    >
      <div>
        <h2 className="text-lg font-bold text-navy">Human Review & Assembly</h2>
        <p className="mt-1 text-sm text-ink-secondary">
          Review Scene Intents and Story plan, then create the Assembly Definition metadata.
          Provider execution stays locked.
        </p>
      </div>

      {/* Status triad — always separate */}
      <div
        className="grid gap-3 sm:grid-cols-3"
        data-testid="review-status-triad"
      >
        <StatusTile
          label="Review"
          value={formatReviewStatus(model?.review.status)}
          testId="status-review"
        />
        <StatusTile
          label="Execution Plan"
          value={formatExecutionReadiness(model?.executionReadiness)}
          testId="status-readiness"
        />
        <StatusTile
          label="Execution"
          value={formatExecutionLockLabel(model?.executionLockCode ?? PHASE1_EXECUTION_LOCKED)}
          testId="status-execution-lock"
        />
      </div>

      <div className="rounded-xl border border-border bg-surface-muted p-4 text-sm">
        <h3 className="font-semibold text-navy">Execution Plan summary</h3>
        <dl className="mt-3 grid gap-2 sm:grid-cols-2">
          <SummaryRow label="Story" value={storyTitle || "—"} />
          <SummaryRow label="Execution Plan" value={shortenId(executionPlanId)} />
          <SummaryRow label="Story Version" value={shortenId(storyVersionId)} />
          <SummaryRow
            label="Animation Package"
            value={shortenId(animationPackageId ?? model?.executionPlan.animationPackageId)}
          />
          <SummaryRow
            label="Scene count"
            value={String(model?.review.scenes.length ?? sceneIntentHints.length ?? 0)}
          />
          <SummaryRow
            label="Assembly"
            value={
              model?.assemblyDefinition.status === "PERSISTED" ? "Persisted" : "Not created"
            }
          />
        </dl>
        <button
          type="button"
          className="mt-3 text-xs text-brand-blue hover:underline"
          onClick={() => setShowAdvanced((v) => !v)}
        >
          {showAdvanced ? "Hide advanced details" : "Show advanced details"}
        </button>
        {showAdvanced ? (
          <dl className="mt-2 space-y-1 text-xs text-ink-secondary">
            <SummaryRow label="Full Execution Plan ID" value={executionPlanId} />
            <SummaryRow label="Compilation hash" value={compilationHash || "—"} />
            <SummaryRow
              label="Integrity hash"
              value={model?.assemblyDefinition.integrityHash || "—"}
            />
          </dl>
        ) : null}
      </div>

      {error ? (
        <div
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          data-testid="review-assembly-error"
          data-error-code={error.code ?? ""}
          role="alert"
        >
          {error.message}
          {error.code ? (
            <span className="mt-1 block text-xs text-red-700/80">{error.code}</span>
          ) : null}
          <button
            type="button"
            className="mt-2 text-xs font-medium text-red-900 underline"
            onClick={() => void reloadCanonical("reload")}
            disabled={busy}
          >
            Reload
          </button>
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-ink-secondary" data-testid="review-loading">
          Loading review…
        </p>
      ) : null}

      {!loading && !reviewOpened ? (
        <div className="rounded-xl border border-dashed border-border p-4" data-testid="review-empty">
          <p className="text-sm text-ink-secondary">
            Review has not been opened for this Execution Plan yet.
          </p>
          {canMutate ? (
            <button
              type="button"
              className="brand-btn-primary mt-3"
              disabled={busy}
              onClick={() => void handleOpenReview()}
              data-testid="open-review"
            >
              {pending === "open" ? "Opening…" : "Open Review"}
            </button>
          ) : (
            <p className="mt-2 text-xs text-ink-secondary">
              Read-only — an operator must open Review.
            </p>
          )}
        </div>
      ) : null}

      {!loading && reviewOpened && model ? (
        <>
          {terminalRejected ? (
            <div
              className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950"
              data-testid="review-rejected-banner"
            >
              Review is Rejected. Incompatible approval actions are disabled.
            </div>
          ) : null}

          <div className="space-y-3" data-testid="scene-review-list">
            <h3 className="text-sm font-semibold text-navy">Scene review</h3>
            {[...model.review.scenes]
              .sort((a, b) => a.sceneOrder - b.sceneOrder)
              .map((scene) => {
                const hint = hintByScene.get(scene.sceneExecutionId);
                const scenePending =
                  pending === `scene:${scene.sceneExecutionId}:APPROVED` ||
                  pending === `scene:${scene.sceneExecutionId}:REJECTED`;
                return (
                  <article
                    key={scene.sceneExecutionId}
                    className="rounded-xl border border-border bg-surface-muted p-4"
                    data-testid={`scene-card-${scene.sceneOrder}`}
                    data-scene-execution-id={scene.sceneExecutionId}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h4 className="font-semibold text-navy">
                          Scene {scene.sceneOrder + 1}
                          <span className="ml-2 text-xs font-normal text-ink-secondary">
                            {scene.sceneId}
                          </span>
                        </h4>
                        {hint?.purpose ? (
                          <p className="mt-1 text-sm text-ink-secondary">{hint.purpose}</p>
                        ) : null}
                        <p className="mt-1 text-xs text-ink-secondary">
                          {hint?.shotCount != null ? `${hint.shotCount} shots · ` : null}
                          {hint?.plannedDurationMs != null
                            ? `${(hint.plannedDurationMs / 1000).toFixed(1)}s planned`
                            : null}
                          {hint?.referencedAssetIds?.length
                            ? ` · ${hint.referencedAssetIds.length} asset(s)`
                            : null}
                        </p>
                      </div>
                      <div className="text-right text-xs">
                        <div>
                          Decision:{" "}
                          <strong>{scene.decision ?? "Pending"}</strong>
                        </div>
                        <div className="mt-1">
                          QC:{" "}
                          <strong>
                            {scene.qc?.status ?? "n/a"}
                            {scene.qc
                              ? ` (${scene.qc.findingCount} findings)`
                              : null}
                          </strong>
                        </div>
                      </div>
                    </div>

                    {scene.qc && scene.qc.findings.length > 0 ? (
                      <ul className="mt-3 space-y-1 text-xs text-ink-secondary">
                        {scene.qc.findings.map((f) => (
                          <li key={`${f.code}-${f.message}`}>
                            [{f.severity}] {f.code}: {f.message}
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    {canMutate && model.review.status !== "APPROVED" ? (
                      <div className="mt-3 space-y-2">
                        <label className="block text-xs text-ink-secondary">
                          Comment (optional)
                          <input
                            type="text"
                            className="mt-1 w-full rounded-lg border border-border bg-white px-2 py-1.5 text-sm"
                            value={sceneComments[scene.sceneExecutionId] ?? ""}
                            disabled={busy || terminalRejected}
                            onChange={(e) =>
                              setSceneComments((prev) => ({
                                ...prev,
                                [scene.sceneExecutionId]: e.target.value,
                              }))
                            }
                          />
                        </label>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="brand-btn-primary"
                            disabled={busy || terminalRejected}
                            onClick={() =>
                              void handleSceneDecision(scene.sceneExecutionId, "APPROVED")
                            }
                            data-testid={`approve-scene-${scene.sceneOrder}`}
                          >
                            {pending === `scene:${scene.sceneExecutionId}:APPROVED`
                              ? "Saving…"
                              : "Approve Scene"}
                          </button>
                          <button
                            type="button"
                            className="brand-btn-secondary"
                            disabled={busy}
                            onClick={() =>
                              void handleSceneDecision(scene.sceneExecutionId, "REJECTED")
                            }
                            data-testid={`reject-scene-${scene.sceneOrder}`}
                          >
                            {pending === `scene:${scene.sceneExecutionId}:REJECTED`
                              ? "Saving…"
                              : "Reject Scene"}
                          </button>
                        </div>
                        {scenePending ? (
                          <p className="text-xs text-ink-secondary">Saving decision…</p>
                        ) : null}
                      </div>
                    ) : null}
                  </article>
                );
              })}
          </div>

          <div className="rounded-xl border border-border p-4" data-testid="story-review">
            <h3 className="text-sm font-semibold text-navy">Story review</h3>
            <p className="mt-1 text-xs text-ink-secondary">
              Story approval requires every Scene approved and no blocking QC findings.
              Approval does not unlock execution.
            </p>
            {model.review.storyDecision ? (
              <p className="mt-2 text-sm">
                Story decision: <strong>{model.review.storyDecision.decision}</strong>
              </p>
            ) : null}
            {canMutate && model.review.status !== "APPROVED" ? (
              <div className="mt-3 space-y-2">
                <label className="block text-xs text-ink-secondary">
                  Comment (optional)
                  <input
                    type="text"
                    className="mt-1 w-full rounded-lg border border-border px-2 py-1.5 text-sm"
                    value={storyComment}
                    disabled={busy || terminalRejected}
                    onChange={(e) => setStoryComment(e.target.value)}
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="brand-btn-primary"
                    disabled={busy || terminalRejected}
                    onClick={() => void handleStoryDecision("APPROVED")}
                    data-testid="approve-story"
                    data-eligible={storyEligible ? "true" : "false"}
                    title={
                      !storyEligible
                        ? "All required Scenes must be approved before Story approval succeeds"
                        : undefined
                    }
                  >
                    {pending === "story:APPROVED" ? "Saving…" : "Approve Story"}
                  </button>
                  <button
                    type="button"
                    className="brand-btn-secondary"
                    disabled={busy || terminalRejected}
                    onClick={() => void handleStoryDecision("REJECTED")}
                    data-testid="reject-story"
                  >
                    {pending === "story:REJECTED" ? "Saving…" : "Reject Story"}
                  </button>
                </div>
                {!storyEligible && !terminalRejected ? (
                  <p className="text-xs text-ink-secondary" data-testid="story-not-eligible-hint">
                    Story Approve stays unavailable until every required Scene is approved.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="rounded-xl border border-border p-4" data-testid="assembly-definition">
            <h3 className="text-sm font-semibold text-navy">Assembly Definition</h3>
            {!assemblyAvailable ? (
              <p className="mt-2 text-sm text-ink-secondary" data-testid="assembly-unavailable">
                Assembly Definition is unavailable until all Scenes and the Story are approved.
              </p>
            ) : model.assemblyDefinition.status === "PERSISTED" ? (
              <div className="mt-2 space-y-2 text-sm" data-testid="assembly-persisted">
                <p>
                  Status: <strong>Persisted</strong>
                </p>
                <p>ID: {shortenId(model.assemblyDefinition.id)}</p>
                <p>Scene count: {model.assemblyDefinition.sceneCount}</p>
                <ol className="list-decimal space-y-1 pl-5 text-xs text-ink-secondary">
                  {model.assemblyDefinition.memberships
                    .slice()
                    .sort((a, b) => a.sceneOrder - b.sceneOrder)
                    .map((m) => (
                      <li key={m.membershipId}>
                        Scene {m.sceneOrder + 1} ({m.sceneId})
                      </li>
                    ))}
                </ol>
                {canMutate ? (
                  <button
                    type="button"
                    className="brand-btn-secondary mt-2"
                    disabled={busy}
                    onClick={() => void handleCreateAssembly()}
                    data-testid="reload-assembly"
                  >
                    {pending === "assembly" ? "Loading…" : "Reload Assembly Definition"}
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="mt-2" data-testid="assembly-available">
                <p className="text-sm text-ink-secondary">
                  Review is approved. Create the deterministic Assembly Definition metadata.
                </p>
                {canMutate ? (
                  <button
                    type="button"
                    className="brand-btn-primary mt-3"
                    disabled={busy}
                    onClick={() => void handleCreateAssembly()}
                    data-testid="create-assembly"
                  >
                    {pending === "assembly" ? "Creating…" : "Create Assembly Definition"}
                  </button>
                ) : (
                  <p className="mt-2 text-xs text-ink-secondary">
                    Read-only — operators create the Assembly Definition.
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-border p-4" data-testid="review-history">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-navy">Review history</h3>
              <button
                type="button"
                className="text-xs text-brand-blue hover:underline"
                disabled={busy}
                onClick={() => void reloadCanonical("reload")}
              >
                Refresh
              </button>
            </div>
            {!history || history.events.length === 0 ? (
              <p className="mt-2 text-sm text-ink-secondary">No history events yet.</p>
            ) : (
              <ul className="mt-3 space-y-2 text-sm">
                {history.events.map((event, index) => (
                  <li
                    key={`${event.kind}-${event.at}-${index}`}
                    className="rounded-lg border border-border/70 bg-surface-muted px-3 py-2"
                    data-testid={`history-event-${index}`}
                  >
                    <div className="font-medium text-navy">
                      {formatHistoryKind(event.kind, event.decision)}
                    </div>
                    <div className="mt-0.5 text-xs text-ink-secondary">
                      {event.sceneId ? `Scene ${event.sceneId} · ` : null}
                      {event.actorId ? `Actor ${shortenId(event.actorId)} · ` : null}
                      {new Date(event.at).toLocaleString()}
                      {event.comment ? ` · “${event.comment}”` : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p
            className="text-xs text-ink-secondary"
            data-testid="execution-lock-footnote"
          >
            Execution: Locked until Phase 3 · executionAllowed=false · no Execute action
          </p>
        </>
      ) : null}
    </section>
  );
}

function StatusTile({
  label,
  value,
  testId,
}: {
  label: string;
  value: string;
  testId: string;
}) {
  return (
    <div
      className="rounded-xl border border-border bg-surface-muted px-3 py-3"
      data-testid={testId}
    >
      <div className="text-xs uppercase tracking-wide text-ink-secondary">{label}</div>
      <div className="mt-1 text-sm font-semibold text-navy">{value}</div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-ink-secondary">{label}</dt>
      <dd className="break-all font-medium text-navy">{value}</dd>
    </div>
  );
}

function formatHistoryKind(
  kind: string,
  decision?: HumanReviewDecision
): string {
  if (kind === "REVIEW_OPENED") return "Review opened";
  if (kind === "SCENE_DECISION") {
    return decision === "REJECTED" ? "Scene rejected" : "Scene approved";
  }
  if (kind === "STORY_DECISION") {
    return decision === "REJECTED" ? "Story rejected" : "Story approved";
  }
  if (kind === "STATUS_DERIVED") return "Status updated";
  return kind;
}
