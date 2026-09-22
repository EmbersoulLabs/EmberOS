"use client";

import { useEffect, useState } from "react";
import {
  AI_STORY_REUSABLE_CHARACTER_COPY,
  type AiStoryReusableCharacterCard,
} from "@ceo-agent/shared";

export function ReusableCharacterLibraryPanel({ workspaceId, canEdit }: { workspaceId: string; canEdit: boolean }) {
  const [characters, setCharacters] = useState<AiStoryReusableCharacterCard[]>([]);
  const [error, setError] = useState("");
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

  async function create() {
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
      <div>
        <h1 className="text-2xl font-bold text-navy">{AI_STORY_REUSABLE_CHARACTER_COPY.characters}</h1>
        <p className="mt-1 text-sm text-ink-secondary">Reuse the same canonical Character across Episodes. Identity stays locked; Episode look can change.</p>
      </div>
      {error ? <p className="text-sm text-red-700" role="alert">{error}</p> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        {characters.map((character) => (
          <article key={character.reusableCharacterId} className="rounded-xl border border-border bg-white p-4">
            <h2 className="font-semibold text-navy">{character.name}</h2>
            <p className="mt-1 text-sm text-ink-secondary">{AI_STORY_REUSABLE_CHARACTER_COPY.usedInEpisodes(character.episodeCount)}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="rounded-lg border border-border px-3 py-1.5 text-sm">{AI_STORY_REUSABLE_CHARACTER_COPY.useInEpisode}</span>
              {canEdit ? <span className="rounded-lg border border-border px-3 py-1.5 text-sm">{AI_STORY_REUSABLE_CHARACTER_COPY.editCharacter}</span> : null}
            </div>
          </article>
        ))}
      </div>
      {canEdit ? (
        <form className="space-y-3 rounded-2xl border border-border bg-white p-4" onSubmit={(event) => { event.preventDefault(); void create(); }}>
          <h2 className="font-semibold text-navy">Add reusable Character</h2>
          <input className="w-full rounded-lg border border-border px-3 py-2 text-sm" placeholder="Name" value={name} onChange={(event) => setName(event.target.value)} />
          <textarea className="min-h-20 w-full rounded-lg border border-border px-3 py-2 text-sm" placeholder="Identity" value={identity} onChange={(event) => setIdentity(event.target.value)} />
          <textarea className="min-h-20 w-full rounded-lg border border-border px-3 py-2 text-sm" placeholder="Face identity" value={face} onChange={(event) => setFace(event.target.value)} />
          <textarea className="min-h-20 w-full rounded-lg border border-border px-3 py-2 text-sm" placeholder="Body identity" value={body} onChange={(event) => setBody(event.target.value)} />
          <input className="w-full rounded-lg border border-border px-3 py-2 text-sm" placeholder="IDENTITY_MASTER asset id" value={assetId} onChange={(event) => setAssetId(event.target.value)} />
          <button type="submit" className="brand-btn-primary" disabled={busy || !name || !identity || !face || !body || !assetId}>{busy ? "Saving…" : "Save Character"}</button>
        </form>
      ) : null}
    </section>
  );
}
