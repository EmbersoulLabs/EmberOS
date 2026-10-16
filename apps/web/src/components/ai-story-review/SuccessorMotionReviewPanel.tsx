"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AI_STORY_SUCCESSOR_MOTION_REVIEW_CONTRACT_VERSION,
  SUCCESSOR_MOTION_LATEST_CREATIVE_DECISION,
  SUCCESSOR_MOTION_SCENE_1_CREATIVE_DECISION,
  SUCCESSOR_MOTION_SCENE_3_CREATIVE_DECISION,
  SUCCESSOR_MOTION_SUPERSEDED_DECISION,
  type AiStoryEpisodeProjectedMotionPlan,
  type AiStorySuccessorMotionSceneDecision,
} from "@ceo-agent/shared";

type ReadModel = {
  active: AiStoryEpisodeProjectedMotionPlan | null;
  pending: AiStoryEpisodeProjectedMotionPlan | null;
  history: AiStoryEpisodeProjectedMotionPlan[];
};

type Draft = Partial<AiStorySuccessorMotionSceneDecision> & { sceneOrder: number; scriptSceneId: string; productAuthorityId: string; canonicalActions: string[] };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Successor Motion request failed");
  return body as T;
}

export function SuccessorMotionReviewPanel({ campaignId, storyId }: { campaignId: string; storyId: string }) {
  const endpoint = `/api/campaigns/${campaignId}/ai-stories/${storyId}/successor-motion`;
  const [model, setModel] = useState<ReadModel | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [approvalAttested, setApprovalAttested] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const next = await request<ReadModel>(endpoint);
      setModel(next);
      if (!next.pending && next.active) {
        setDrafts(next.active.sceneMotionPlans.filter((scene) => scene.sceneOrder === 0 || scene.sceneOrder === 2).map((scene) => ({
          sceneOrder: scene.sceneOrder,
          scriptSceneId: scene.scriptSceneId,
          productAuthorityId: scene.productBindingIds[0] ?? "",
          canonicalActions: scene.actions.map((action) => action.semanticAction),
          creativeDecision: scene.sceneOrder === 0 ? SUCCESSOR_MOTION_SCENE_1_CREATIVE_DECISION : SUCCESSOR_MOTION_SCENE_3_CREATIVE_DECISION,
        })));
      }
    } catch (value) {
      setError(value instanceof Error ? value.message : "Successor Motion could not be loaded");
    }
  }, [endpoint]);

  useEffect(() => { void load(); }, [load]);

  function update(index: number, patch: Partial<Draft>) {
    setDrafts((current) => current.map((draft, itemIndex) => itemIndex === index ? { ...draft, ...patch } : draft));
  }

  const proposalReady = useMemo(() => drafts.length === 2 && drafts.every((draft) =>
    draft.productAuthorityId && draft.worldStateAtEntry && draft.worldStateAtExit && draft.visibilityTransition &&
    draft.identityOutcome && draft.physicalConditionAtEntry?.trim() && draft.physicalConditionAtExit?.trim() &&
    draft.ownershipAtEntry?.trim() && draft.ownershipAtExit?.trim() && draft.actionProgression?.length &&
    draft.cameraBehavior && draft.rationale?.trim()), [drafts]);

  async function action(actionName: "PROPOSE" | "VALIDATE" | "APPROVE" | "ACTIVATE") {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const pendingId = model?.pending?.motionPlanId;
      const body = actionName === "PROPOSE" ? {
        action: actionName,
        review: {
          contractVersion: AI_STORY_SUCCESSOR_MOTION_REVIEW_CONTRACT_VERSION,
          baseMotionPlanId: model?.active?.motionPlanId,
          supersededDecision: SUCCESSOR_MOTION_SUPERSEDED_DECISION,
          latestCreativeDecision: SUCCESSOR_MOTION_LATEST_CREATIVE_DECISION,
          scenes: drafts.map(({ canonicalActions: _canonicalActions, ...draft }) => draft),
          submittedBy: model?.active?.createdBy,
          submittedAt: new Date().toISOString(),
        },
      } : { action: actionName, motionPlanId: pendingId, ...(actionName === "APPROVE" ? { approvalAttestation: "AUTHORIZED_CREATIVE_OWNER_APPROVAL" } : {}) };
      await request(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      await load();
    } catch (value) {
      setError(value instanceof Error ? value.message : "Successor Motion action failed");
    } finally {
      setBusy(false);
    }
  }

  const pending = model?.pending;
  return <section className="space-y-4 rounded-xl border border-amber-200 bg-amber-50/40 p-4" data-testid="successor-motion-review">
    <div>
      <h3 className="font-semibold text-navy">Successor Motion creative review</h3>
      <p className="mt-1 text-sm text-ink-secondary">One consolidated human decision for Scene 1 and Scene 3. Camera visibility, in-world existence, appearance, identity and ownership are recorded separately.</p>
    </div>
    <div className="rounded-lg border border-amber-200 bg-white p-3 text-sm">
      <p><strong>Latest authoritative intent:</strong> {SUCCESSOR_MOTION_LATEST_CREATIVE_DECISION}</p>
      <p className="mt-2 text-xs text-ink-secondary"><strong>Superseded:</strong> {SUCCESSOR_MOTION_SUPERSEDED_DECISION}</p>
      <p className="mt-2 text-xs text-ink-secondary">Leaving the camera frame does not mean ceasing to exist. Appearance change does not by itself change product identity. Replacement, destruction, ownership transfer, physical transformation, action changes or camera changes require matching upstream authority.</p>
    </div>
    {error ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
    {!model ? <p className="text-sm text-ink-secondary">Loading Motion authority…</p> : null}
    {model?.active ? <p className="text-xs text-ink-secondary">Active Motion v{model.active.version}: {model.active.motionPlanId} ({model.active.status})</p> : null}
    {!pending && drafts.map((draft, index) => <fieldset key={draft.scriptSceneId} className="space-y-3 rounded-lg border border-border bg-white p-4">
      <legend className="px-1 font-semibold text-navy">Scene {draft.sceneOrder + 1}</legend>
      <p className="text-xs text-ink-secondary">Product authority: {draft.productAuthorityId || "Missing binding"}</p>
      <div className="grid gap-3 md:grid-cols-2">
        <Select label="In-world state at entry" value={draft.worldStateAtEntry} onChange={(value) => update(index, { worldStateAtEntry: value as Draft["worldStateAtEntry"] })} options={["PRESENT", "ABSENT"]} />
        <Select label="In-world state at exit" value={draft.worldStateAtExit} onChange={(value) => update(index, { worldStateAtExit: value as Draft["worldStateAtExit"] })} options={["PRESENT", "ABSENT"]} />
        <Select label="Camera visibility path" value={draft.visibilityTransition} onChange={(value) => update(index, { visibilityTransition: value as Draft["visibilityTransition"] })} options={["CONTINUOUSLY_IN_FRAME", "LEAVES_FRAME_AND_RETURNS", "LEAVES_FRAME_THROUGH_EXIT", "ENTERS_FRAME_AFTER_ENTRY", "OUT_OF_FRAME_INTERVAL"]} />
        <Select label="Product identity outcome" value={draft.identityOutcome} onChange={(value) => update(index, { identityOutcome: value as Draft["identityOutcome"] })} options={["PRESERVED_UNCHANGED", "APPEARANCE_CHANGED_IDENTITY_PRESERVED", "IDENTITY_REPLACED_OR_DESTROYED"]} />
        <TextInput label="Physical condition at entry" value={draft.physicalConditionAtEntry} onChange={(value) => update(index, { physicalConditionAtEntry: value })} />
        <TextInput label="Physical condition at exit" value={draft.physicalConditionAtExit} onChange={(value) => update(index, { physicalConditionAtExit: value })} />
        <TextInput label="Ownership at entry" value={draft.ownershipAtEntry} onChange={(value) => update(index, { ownershipAtEntry: value })} />
        <TextInput label="Ownership at exit" value={draft.ownershipAtExit} onChange={(value) => update(index, { ownershipAtExit: value })} />
        <Select label="Camera authority" value={draft.cameraBehavior} onChange={(value) => update(index, { cameraBehavior: value as Draft["cameraBehavior"] })} options={["PRESERVE_FROZEN_SHOT", "REVISED_CAMERA_REQUIRED"]} />
      </div>
      <label className="block text-xs text-ink-secondary">Action progression (one explicit phase per line)
        <textarea className="mt-1 min-h-20 w-full rounded-lg border border-border p-2 text-sm" value={(draft.actionProgression ?? []).join("\n")} onChange={(event) => update(index, { actionProgression: event.target.value.split("\n").map((value) => value.trim()).filter(Boolean) })} placeholder={`Frozen Script action:\n${draft.canonicalActions.join("\n")}`} />
      </label>
      <label className="block text-xs text-ink-secondary">Creative rationale
        <textarea className="mt-1 min-h-20 w-full rounded-lg border border-border p-2 text-sm" value={draft.rationale ?? ""} onChange={(event) => update(index, { rationale: event.target.value })} />
      </label>
    </fieldset>)}
    {!pending && model?.active ? <button type="button" className="brand-btn-primary" disabled={busy || !proposalReady} onClick={() => void action("PROPOSE")} data-testid="propose-successor-motion">Save immutable successor draft</button> : null}
    {pending ? <div className="space-y-3 rounded-lg border border-border bg-white p-4" data-testid="successor-motion-lifecycle">
      <p className="font-medium text-navy">Successor Motion v{pending.version}: {pending.status}</p>
      <p className="text-xs text-ink-secondary">Base {pending.supersedesMotionPlanId} remains FROZEN until this revision is formally approved and activated.</p>
      {pending.status === "DRAFT" ? <button className="brand-btn-primary" disabled={busy} onClick={() => void action("VALIDATE")}>Run deterministic validation</button> : null}
      {pending.status === "VALIDATED" ? <>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={approvalAttested} onChange={(event) => setApprovalAttested(event.target.checked)} />I am the authorized human creative owner and approve these exact facts as the successor Motion authority.</label>
        <button className="brand-btn-primary" disabled={busy || !approvalAttested} onClick={() => void action("APPROVE")} data-testid="approve-successor-motion">Approve successor Motion</button>
      </> : null}
      {pending.status === "APPROVED" ? <button className="brand-btn-primary" disabled={busy} onClick={() => void action("ACTIVATE")} data-testid="activate-successor-motion">Activate approved successor</button> : null}
    </div> : null}
  </section>;
}

function Select({ label, value, onChange, options }: { label: string; value?: string; onChange: (value: string) => void; options: string[] }) {
  return <label className="block text-xs text-ink-secondary">{label}<select className="mt-1 w-full rounded-lg border border-border bg-white p-2 text-sm text-navy" value={value ?? ""} onChange={(event) => onChange(event.target.value)}><option value="">Select explicit fact…</option>{options.map((option) => <option key={option} value={option}>{option.replaceAll("_", " ")}</option>)}</select></label>;
}

function TextInput({ label, value, onChange }: { label: string; value?: string; onChange: (value: string) => void }) {
  return <label className="block text-xs text-ink-secondary">{label}<input className="mt-1 w-full rounded-lg border border-border p-2 text-sm text-navy" value={value ?? ""} onChange={(event) => onChange(event.target.value)} /></label>;
}
