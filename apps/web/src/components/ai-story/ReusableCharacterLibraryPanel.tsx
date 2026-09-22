"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AI_STORY_CHARACTER_VIRTUALIZER_COPY,
  AI_STORY_REUSABLE_CHARACTER_COPY,
  type AiStoryReusableCharacterCard,
} from "@ceo-agent/shared";
import { CharacterPortrait } from "./CharacterPortrait";
import { CharacterVirtualizerWizard } from "./CharacterVirtualizerWizard";

type Card = AiStoryReusableCharacterCard & {
  visualClass?: string;
  virtualStyle?: string;
  identityLocked?: boolean;
};

const STYLE_LABEL: Record<string, string> = {
  PREMIUM_3D: AI_STORY_CHARACTER_VIRTUALIZER_COPY.premium3d,
  STYLIZED_CGI: AI_STORY_CHARACTER_VIRTUALIZER_COPY.stylizedCgi,
  ILLUSTRATED: AI_STORY_CHARACTER_VIRTUALIZER_COPY.illustrated,
};

export function ReusableCharacterLibraryPanel({
  workspaceId,
  slug,
  canEdit,
  isSuperAdmin = false,
}: {
  workspaceId: string;
  slug: string;
  canEdit: boolean;
  isSuperAdmin?: boolean;
}) {
  const [characters, setCharacters] = useState<Card[]>([]);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [name, setName] = useState("");
  const [identity, setIdentity] = useState("");
  const [face, setFace] = useState("");
  const [body, setBody] = useState("");
  const [assetId, setAssetId] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const response = await fetch(`/api/workspaces/${workspaceId}/reusable-characters`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Characters could not be loaded");
    setCharacters(data.characters ?? []);
  }

  useEffect(() => {
    void load().catch((reason) => setError(reason instanceof Error ? reason.message : "Characters could not be loaded"));
  }, [workspaceId]);

  async function createManual() {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/reusable-characters`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          identityCore: {
            identityDescription: identity,
            faceIdentityDescription: face,
            bodyIdentityDescription: body,
            distinctiveVisualFacts: [],
            mustPreserve: ["face identity"],
            mustNeverChange: ["canonical face identity"],
          },
          defaultLook: { wardrobe: "default wardrobe", makeup: null, accessories: null, hairstyle: null, hairColor: null },
          mutableLookPolicy: { wardrobeAllowed: true, makeupAllowed: true, accessoriesAllowed: true, hairstyleAllowed: true, hairColorAllowed: false },
          canonicalAssets: [{ assetId, role: "IDENTITY_MASTER" }],
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Character could not be saved");
      setName(""); setIdentity(""); setFace(""); setBody(""); setAssetId("");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Character could not be saved");
    } finally { setBusy(false); }
  }

  return (
    <section className="space-y-4" data-testid="reusable-character-library">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-navy">{AI_STORY_REUSABLE_CHARACTER_COPY.characters}</h1>
          <p className="mt-1 text-sm text-ink-secondary">Reuse the same canonical Character across Episodes. Identity stays locked; Episode look can change.</p>
        </div>
        {canEdit ? (
          <button type="button" className="brand-btn-primary" data-testid="create-character" onClick={() => setCreating(true)}>
            {AI_STORY_CHARACTER_VIRTUALIZER_COPY.createCharacter}
          </button>
        ) : null}
      </div>
      {error ? <p className="text-sm text-red-700" role="alert">{error}</p> : null}
      {creating && canEdit ? (
        <CharacterVirtualizerWizard workspaceId={workspaceId} onSaved={() => { setCreating(false); void load(); }} />
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        {characters.map((character) => (
          <article key={character.reusableCharacterId} className="rounded-xl border border-border bg-white p-4" data-testid="character-card">
            <CharacterPortrait workspaceId={workspaceId} assetId={character.portraitAssetId} label={character.name} className="mb-3 h-40 w-full rounded-lg object-cover" />
            <h2 className="font-semibold text-navy">{character.name}</h2>
            <p className="mt-1 text-sm text-ink-secondary">{AI_STORY_CHARACTER_VIRTUALIZER_COPY.virtualCharacter}</p>
            {character.virtualStyle ? <p className="text-sm text-ink-secondary">{STYLE_LABEL[character.virtualStyle] ?? character.virtualStyle}</p> : null}
            <p className="mt-1 text-sm text-ink-secondary">{AI_STORY_REUSABLE_CHARACTER_COPY.usedInEpisodes(character.episodeCount)}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="rounded-lg border border-border px-3 py-1.5 text-sm">{AI_STORY_REUSABLE_CHARACTER_COPY.useInEpisode}</span>
              {canEdit ? (
                <Link href={`/w/${slug}/characters/${character.reusableCharacterId}`} className="rounded-lg border border-border px-3 py-1.5 text-sm">
                  {AI_STORY_REUSABLE_CHARACTER_COPY.editCharacter}
                </Link>
              ) : null}
            </div>
          </article>
        ))}
      </div>
      {canEdit && isSuperAdmin ? (
        <details className="rounded-2xl border border-border bg-white p-4" data-testid="advanced-character-setup" open={advanced} onToggle={(event) => setAdvanced((event.target as HTMLDetailsElement).open)}>
          <summary className="cursor-pointer font-semibold text-navy">{AI_STORY_CHARACTER_VIRTUALIZER_COPY.advancedSetup}</summary>
          <form className="mt-3 space-y-3" onSubmit={(event) => { event.preventDefault(); void createManual(); }}>
            <input className="w-full rounded-lg border border-border px-3 py-2 text-sm" placeholder="Name" value={name} onChange={(event) => setName(event.target.value)} />
            <textarea className="min-h-20 w-full rounded-lg border border-border px-3 py-2 text-sm" placeholder="Identity" value={identity} onChange={(event) => setIdentity(event.target.value)} />
            <textarea className="min-h-20 w-full rounded-lg border border-border px-3 py-2 text-sm" placeholder="Face identity" value={face} onChange={(event) => setFace(event.target.value)} />
            <textarea className="min-h-20 w-full rounded-lg border border-border px-3 py-2 text-sm" placeholder="Body identity" value={body} onChange={(event) => setBody(event.target.value)} />
            <input className="w-full rounded-lg border border-border px-3 py-2 text-sm" data-testid="advanced-identity-master" placeholder="IDENTITY_MASTER asset id" value={assetId} onChange={(event) => setAssetId(event.target.value)} />
            <button type="submit" className="brand-btn-primary" disabled={busy || !name || !identity || !face || !body || !assetId}>{busy ? "Saving…" : "Save Character"}</button>
          </form>
        </details>
      ) : null}
    </section>
  );
}
