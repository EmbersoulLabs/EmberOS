"use client";

import { useState } from "react";
import {
  AI_STORY_CHARACTER_DNA_COPY,
  DEFAULT_CHARACTER_DNA_MUST_PRESERVE,
  DEFAULT_CHARACTER_DNA_MUTABLE_TRAITS,
  type AiStoryCharacterDna,
  type AiStoryCharacterDnaPublicJob,
} from "@ceo-agent/shared";
import { uploadLibraryFile } from "@/lib/library-upload";
import { CharacterPortrait } from "./CharacterPortrait";

function joinFacts(values: string[]) {
  return values.join("\n");
}

function splitFacts(value: string) {
  return value.split("\n").map((item) => item.trim()).filter(Boolean);
}

export function CharacterDnaWizard({
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
  const [job, setJob] = useState<AiStoryCharacterDnaPublicJob | null>(null);
  const [name, setName] = useState("");
  const [face, setFace] = useState("");
  const [hair, setHair] = useState("");
  const [body, setBody] = useState("");
  const [appearance, setAppearance] = useState("");
  const [distinctive, setDistinctive] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function applyDna(dna: AiStoryCharacterDna) {
    setFace([dna.face.shape, dna.face.jawline, dna.eyes.shape, dna.eyes.colorDescription, dna.nose.bridge, dna.mouth.lipShape].join(", "));
    setHair([dna.hair.length, dna.hair.texture, dna.hair.style, dna.hair.colorDescription].join(", "));
    setBody([dna.body.build, dna.body.proportionDescription, dna.body.heightImpression].join(", "));
    setAppearance([dna.appearance.defaultExpression, dna.appearance.overallImpression, dna.appearance.presentationStyle].join(", "));
    setDistinctive(joinFacts(dna.distinctiveVisualFacts));
  }

  async function upload(file: File) {
    setBusy(true); setError("");
    try {
      const asset = await uploadLibraryFile(workspaceId, file);
      const registered = await fetch(`/api/workspaces/${workspaceId}/character-dna/source`, {
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

  async function analyze() {
    if (!sourceAssetId || !permission) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/character-dna/analyze`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceAssetId, permissionConfirmed: true }),
      });
      const data = await response.json();
      if (!response.ok || !data.job?.proposedDna) {
        throw new Error(data.job?.userSafeError ?? data.error ?? AI_STORY_CHARACTER_DNA_COPY.analysisFailed);
      }
      setJob(data.job);
      applyDna(data.job.proposedDna);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : AI_STORY_CHARACTER_DNA_COPY.analysisFailed);
      setJob(null);
    } finally { setBusy(false); }
  }

  async function save() {
    if (!job?.proposedDna || !name.trim()) return;
    setBusy(true); setError("");
    try {
      const approvedDna: AiStoryCharacterDna = {
        ...job.proposedDna,
        identityDescription: [face, hair, body, appearance].filter(Boolean).join(". "),
        face: { ...job.proposedDna.face, shape: face || job.proposedDna.face.shape },
        hair: { ...job.proposedDna.hair, style: hair || job.proposedDna.hair.style },
        body: { ...job.proposedDna.body, proportionDescription: body || job.proposedDna.body.proportionDescription },
        appearance: { ...job.proposedDna.appearance, overallImpression: appearance || job.proposedDna.appearance.overallImpression },
        distinctiveVisualFacts: splitFacts(distinctive),
        mustPreserve: [...DEFAULT_CHARACTER_DNA_MUST_PRESERVE],
        mutableTraits: [...DEFAULT_CHARACTER_DNA_MUTABLE_TRAITS],
      };
      const response = await fetch(`/api/workspaces/${workspaceId}/character-dna/jobs/${job.id}/save`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          approvedDna,
          targetReusableCharacterId: targetReusableCharacterId ?? null,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Character could not be saved");
      onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Character could not be saved");
    } finally { setBusy(false); }
  }

  return (
    <section className="space-y-4 rounded-2xl border border-border bg-white p-4" data-testid="character-dna-wizard">
      <h2 className="font-semibold text-navy">{AI_STORY_CHARACTER_DNA_COPY.createFromPhoto}</h2>
      <p className="text-sm text-ink-secondary">{AI_STORY_CHARACTER_DNA_COPY.consistency}</p>
      {error ? <p className="text-sm text-red-700" role="alert">{error}</p> : null}

      <label className="block space-y-1">
        <span className="text-sm font-medium text-navy">{AI_STORY_CHARACTER_DNA_COPY.uploadPhoto}</span>
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
      {sourceAssetId ? <CharacterPortrait workspaceId={workspaceId} assetId={sourceAssetId} label={AI_STORY_CHARACTER_DNA_COPY.sourcePhoto} /> : null}

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" data-testid="character-permission-confirm" checked={permission} onChange={(event) => setPermission(event.target.checked)} />
        I confirm I have permission to use this photo.
      </label>

      <button
        type="button"
        className="brand-btn-primary"
        data-testid="character-analyze"
        disabled={busy || !sourceAssetId || !permission}
        onClick={() => void analyze()}
      >
        {busy && !job ? "Analyzing…" : AI_STORY_CHARACTER_DNA_COPY.analyzeCharacter}
      </button>

      {job?.proposedDna ? (
        <div className="space-y-3" data-testid="character-dna-review">
          <h3 className="font-semibold text-navy">{AI_STORY_CHARACTER_DNA_COPY.characterProfile}</h3>
          <input className="w-full rounded-lg border border-border px-3 py-2 text-sm" data-testid="character-name" placeholder="Name" value={name} onChange={(event) => setName(event.target.value)} />
          <label className="block space-y-1">
            <span className="text-sm font-medium text-navy">Face</span>
            <textarea data-testid="character-dna-face" className="min-h-20 w-full rounded-lg border border-border px-3 py-2 text-sm" value={face} onChange={(event) => setFace(event.target.value)} />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-navy">Hair</span>
            <textarea data-testid="character-dna-hair" className="min-h-20 w-full rounded-lg border border-border px-3 py-2 text-sm" value={hair} onChange={(event) => setHair(event.target.value)} />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-navy">Body / proportions</span>
            <textarea data-testid="character-dna-body" className="min-h-20 w-full rounded-lg border border-border px-3 py-2 text-sm" value={body} onChange={(event) => setBody(event.target.value)} />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-navy">Overall appearance</span>
            <textarea data-testid="character-dna-appearance" className="min-h-20 w-full rounded-lg border border-border px-3 py-2 text-sm" value={appearance} onChange={(event) => setAppearance(event.target.value)} />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-navy">Distinctive visual traits</span>
            <textarea data-testid="character-dna-distinctive" className="min-h-20 w-full rounded-lg border border-border px-3 py-2 text-sm" value={distinctive} onChange={(event) => setDistinctive(event.target.value)} />
          </label>
          <div className="rounded-lg bg-surface-muted p-3 text-sm" data-testid="character-dna-rules">
            <p className="font-medium text-navy">{AI_STORY_CHARACTER_DNA_COPY.identityRules}</p>
            <p className="mt-2"><span className="font-medium">{AI_STORY_CHARACTER_DNA_COPY.locked}:</span> face structure, eye shape, nose structure, hair identity, body proportions</p>
            <p className="mt-1"><span className="font-medium">{AI_STORY_CHARACTER_DNA_COPY.mutablePerEpisode}:</span> outfit, makeup, accessories, expression, pose, location</p>
          </div>
          <button type="button" className="brand-btn-primary" data-testid="character-save" disabled={busy || !name.trim()} onClick={() => void save()}>
            {AI_STORY_CHARACTER_DNA_COPY.saveCharacter}
          </button>
        </div>
      ) : null}
    </section>
  );
}
