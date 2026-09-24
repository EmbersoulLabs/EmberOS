"use client";

import { useEffect, useState } from "react";
import {
  AI_STORY_CHARACTER_VIRTUALIZER_COPY,
  DEFAULT_CHARACTER_VIRTUAL_STYLE,
  type AiStoryCharacterVirtualStyle,
  type AiStoryCharacterVirtualizationCostEstimate,
  type AiStoryCharacterVirtualizationPublicJob,
} from "@ceo-agent/shared";
import { uploadLibraryFile } from "@/lib/library-upload";
import { CharacterPortrait } from "./CharacterPortrait";

const STYLES: Array<{ id: AiStoryCharacterVirtualStyle; label: string }> = [
  { id: "PREMIUM_3D", label: AI_STORY_CHARACTER_VIRTUALIZER_COPY.premium3d },
  { id: "STYLIZED_CGI", label: AI_STORY_CHARACTER_VIRTUALIZER_COPY.stylizedCgi },
  { id: "ILLUSTRATED", label: AI_STORY_CHARACTER_VIRTUALIZER_COPY.illustrated },
];

export function CharacterVirtualizerWizard({
  workspaceId,
  targetReusableCharacterId,
  onSaved,
}: {
  workspaceId: string;
  targetReusableCharacterId?: string | null;
  onSaved: () => void;
}) {
  const [sourceAssetId, setSourceAssetId] = useState<string | null>(null);
  const [permission, setPermission] = useState(false);
  const [style, setStyle] = useState<AiStoryCharacterVirtualStyle>(DEFAULT_CHARACTER_VIRTUAL_STYLE);
  const [direction, setDirection] = useState("");
  const [estimate, setEstimate] = useState<AiStoryCharacterVirtualizationCostEstimate | null>(null);
  const [job, setJob] = useState<AiStoryCharacterVirtualizationPublicJob | null>(null);
  const [name, setName] = useState("");
  const [acceptedPreview, setAcceptedPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void fetch(`/api/workspaces/${workspaceId}/character-virtualization/estimate?style=${style}`)
      .then(async (response) => ({ ok: response.ok, body: await response.json() }))
      .then(({ ok, body }) => { if (ok) setEstimate(body.estimate ?? null); })
      .catch(() => undefined);
  }, [style, workspaceId]);

  async function upload(file: File) {
    setBusy(true); setError("");
    try {
      const asset = await uploadLibraryFile(workspaceId, file);
      const registered = await fetch(`/api/workspaces/${workspaceId}/character-virtualization/source`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId: asset.id }),
      });
      const data = await registered.json();
      if (!registered.ok) throw new Error(data.error ?? "Source portrait could not be saved");
      setSourceAssetId(data.sourceAssetId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Source portrait could not be saved");
    } finally { setBusy(false); }
  }

  async function generate(parentJobId?: string) {
    if (!sourceAssetId || !permission) return;
    setBusy(true); setError("");
    try {
      const url = parentJobId
        ? `/api/workspaces/${workspaceId}/character-virtualization/jobs/${parentJobId}/again`
        : `/api/workspaces/${workspaceId}/character-virtualization/jobs`;
      const response = await fetch(url, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parentJobId
          ? { permissionConfirmed: true, costAuthorized: true }
          : {
              sourceAssetId,
              style,
              creativeDirection: direction.trim() || null,
              permissionConfirmed: true,
              costAuthorized: true,
            }),
      });
      const data = await response.json();
      if (!response.ok || data.job?.status === "FAILED" || data.job?.status === "REJECTED") {
        throw new Error(data.job?.userSafeError ?? data.error ?? AI_STORY_CHARACTER_VIRTUALIZER_COPY.providerRejected);
      }
      setJob(data.job);
      setAcceptedPreview(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : AI_STORY_CHARACTER_VIRTUALIZER_COPY.providerRejected);
      setJob(null);
    } finally { setBusy(false); }
  }

  async function save() {
    if (!job || !name.trim()) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/character-virtualization/jobs/${job.id}/accept`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), targetReusableCharacterId: targetReusableCharacterId ?? null }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Character could not be saved");
      onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Character could not be saved");
    } finally { setBusy(false); }
  }

  return (
    <section className="space-y-4 rounded-2xl border border-border bg-white p-4" data-testid="character-virtualizer-wizard">
      <h2 className="font-semibold text-navy">{AI_STORY_CHARACTER_VIRTUALIZER_COPY.createFromPhoto}</h2>
      {error ? <p className="text-sm text-red-700" role="alert">{error}</p> : null}

      <label className="block space-y-1">
        <span className="text-sm font-medium text-navy">{AI_STORY_CHARACTER_VIRTUALIZER_COPY.uploadPhoto}</span>
        <input
          data-testid="character-source-upload"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
          }}
        />
      </label>
      {sourceAssetId ? <CharacterPortrait workspaceId={workspaceId} assetId={sourceAssetId} label={AI_STORY_CHARACTER_VIRTUALIZER_COPY.sourcePhoto} /> : null}

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" data-testid="character-permission-confirm" checked={permission} onChange={(event) => setPermission(event.target.checked)} />
        {AI_STORY_CHARACTER_VIRTUALIZER_COPY.permissionConfirm}
      </label>

      <fieldset className="space-y-2" data-testid="character-style-selector">
        <legend className="text-sm font-medium text-navy">Style</legend>
        {STYLES.map((option) => (
          <label key={option.id} className="mr-4 text-sm">
            <input className="mr-1" type="radio" name="virtualStyle" checked={style === option.id} onChange={() => setStyle(option.id)} />
            {option.label}
          </label>
        ))}
      </fieldset>
      <label className="block space-y-1">
        <span className="text-sm font-medium text-navy">{AI_STORY_CHARACTER_VIRTUALIZER_COPY.creativeDirection}</span>
        <input className="w-full rounded-lg border border-border px-3 py-2 text-sm" value={direction} onChange={(event) => setDirection(event.target.value)} placeholder="friendly SME spokesperson" />
      </label>

      {estimate ? (
        <div className="rounded-lg bg-surface-muted p-3 text-sm" data-testid="character-cost-estimate">
          <p className="font-medium text-navy">{AI_STORY_CHARACTER_VIRTUALIZER_COPY.estimatedCost}</p>
          <p className="mt-1 text-ink-secondary">${estimate.estimatedExpected} USD ({estimate.category})</p>
        </div>
      ) : null}

      <button
        type="button"
        className="brand-btn-primary"
        data-testid="character-generate"
        disabled={busy || !sourceAssetId || !permission}
        onClick={() => void generate()}
      >
        {busy ? "Creating…" : AI_STORY_CHARACTER_VIRTUALIZER_COPY.generate}
      </button>

      {job?.status === "SUCCEEDED" ? (
        <div className="grid gap-3 sm:grid-cols-2" data-testid="character-virtual-preview">
          <div>
            <p className="mb-2 text-sm font-medium text-navy">{AI_STORY_CHARACTER_VIRTUALIZER_COPY.sourcePhoto}</p>
            <CharacterPortrait workspaceId={workspaceId} assetId={job.sourceAssetId} label={AI_STORY_CHARACTER_VIRTUALIZER_COPY.sourcePhoto} />
          </div>
          <div>
            <p className="mb-2 text-sm font-medium text-navy">{AI_STORY_CHARACTER_VIRTUALIZER_COPY.virtualCharacter}</p>
            <CharacterPortrait workspaceId={workspaceId} assetId={job.outputAssetId} label={AI_STORY_CHARACTER_VIRTUALIZER_COPY.virtualCharacter} />
          </div>
          <button type="button" className="rounded-lg border border-border px-3 py-2 text-sm" data-testid="character-generate-again" disabled={busy} onClick={() => void generate(job.id)}>
            {AI_STORY_CHARACTER_VIRTUALIZER_COPY.generateAgain}
          </button>
          <button type="button" className="brand-btn-primary" data-testid="character-use-this" disabled={busy} onClick={() => setAcceptedPreview(true)}>
            {AI_STORY_CHARACTER_VIRTUALIZER_COPY.useThisCharacter}
          </button>
        </div>
      ) : null}

      {acceptedPreview && job?.acceptanceStatus === "VIRTUAL_CHARACTER_CANDIDATE" ? (
        <div className="space-y-2" data-testid="character-save-form">
          <input className="w-full rounded-lg border border-border px-3 py-2 text-sm" data-testid="character-name" placeholder="Character name" value={name} onChange={(event) => setName(event.target.value)} />
          <button type="button" className="brand-btn-primary" data-testid="character-save" disabled={busy || !name.trim()} onClick={() => void save()}>
            {AI_STORY_CHARACTER_VIRTUALIZER_COPY.saveCharacter}
          </button>
        </div>
      ) : null}
    </section>
  );
}
