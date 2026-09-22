"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  AI_STORY_CHARACTER_VIRTUALIZER_COPY,
  additionalReferenceRoles,
  type AiStoryReusableCharacterVersion,
} from "@ceo-agent/shared";
import { AppShell } from "@/components/AppShell";
import { CharacterPortrait } from "@/components/ai-story/CharacterPortrait";
import { CharacterVirtualizerWizard } from "@/components/ai-story/CharacterVirtualizerWizard";
import { uploadLibraryFile } from "@/lib/library-upload";

const ROLE_LABEL: Record<string, string> = {
  FRONT_PORTRAIT: "Front",
  THREE_QUARTER: "3/4",
  PROFILE: "Profile",
  FULL_BODY: "Full body",
  EXPRESSION_REFERENCE: "Expression",
  STYLE_REFERENCE: "Style",
};

export default function CharacterEditPage() {
  const { slug, characterId } = useParams<{ slug: string; characterId: string }>();
  const [workspace, setWorkspace] = useState<{ id: string; name: string; role?: string } | null>(null);
  const [character, setCharacter] = useState<AiStoryReusableCharacterVersion | null>(null);
  const [error, setError] = useState("");
  const [virtualize, setVirtualize] = useState(false);
  const [busy, setBusy] = useState(false);

  async function loadCharacter(workspaceId: string) {
    const response = await fetch(`/api/workspaces/${workspaceId}/reusable-characters/${characterId}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Character could not be loaded");
    setCharacter(data.character);
  }

  useEffect(() => {
    fetch("/api/me").then(async (response) => ({ ok: response.ok, body: await response.json() })).then(async ({ ok, body }) => {
      if (!ok) throw new Error(body.error ?? "Unable to load account");
      const match = body.workspaces?.find((item: { slug: string }) => item.slug === slug);
      if (!match) throw new Error("Workspace not found");
      setWorkspace(match);
      await loadCharacter(match.id);
    }).catch((reason) => setError(reason instanceof Error ? reason.message : "Unable to load Character"));
  }, [slug, characterId]);

  const master = character?.canonicalAssets.find((asset) => asset.role === "IDENTITY_MASTER");
  const canEdit = workspace?.role === "admin" || workspace?.role === "operator";

  async function addReference(role: ReturnType<typeof additionalReferenceRoles>[number], file: File) {
    if (!workspace || !character || !master) return;
    setBusy(true); setError("");
    try {
      const asset = await uploadLibraryFile(workspace.id, file);
      const response = await fetch(`/api/workspaces/${workspace.id}/reusable-characters/${characterId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedVersion: character.version,
          name: character.name,
          identityCore: character.identityCore,
          defaultLook: character.defaultLook,
          mutableLookPolicy: character.mutableLookPolicy,
          canonicalAssets: [
            { assetId: master.assetId, role: "IDENTITY_MASTER" },
            ...character.canonicalAssets.filter((item) => item.role !== "IDENTITY_MASTER").map((item) => ({ assetId: item.assetId, role: item.role })),
            { assetId: asset.id, role },
          ],
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Reference could not be saved");
      await loadCharacter(workspace.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Reference could not be saved");
    } finally { setBusy(false); }
  }

  return (
    <AppShell workspaceName={workspace?.name}>
      <Link href={`/w/${slug}/characters`} className="text-sm text-brand-blue">Back to Characters</Link>
      {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
      {workspace && character ? (
        <section className="mt-4 space-y-4" data-testid="character-edit">
          <h1 className="text-2xl font-bold text-navy">{character.name}</h1>
          <div>
            <h2 className="text-sm font-semibold text-navy">{AI_STORY_CHARACTER_VIRTUALIZER_COPY.identityMaster}</h2>
            <CharacterPortrait workspaceId={workspace.id} assetId={master?.assetId} label={AI_STORY_CHARACTER_VIRTUALIZER_COPY.identityMaster} />
            {canEdit ? (
              <button type="button" className="mt-2 rounded-lg border border-border px-3 py-1.5 text-sm" onClick={() => setVirtualize(true)}>
                Replace / Create new Character version
              </button>
            ) : null}
          </div>
          {virtualize ? (
            <CharacterVirtualizerWizard
              workspaceId={workspace.id}
              targetReusableCharacterId={character.reusableCharacterId}
              onSaved={() => { setVirtualize(false); void loadCharacter(workspace.id); }}
            />
          ) : null}
          <div>
            <h2 className="text-sm font-semibold text-navy">{AI_STORY_CHARACTER_VIRTUALIZER_COPY.additionalReferences}</h2>
            <div className="mt-2 flex flex-wrap gap-2">
              {additionalReferenceRoles().map((role) => (
                <label key={role} className="rounded-lg border border-border px-3 py-1.5 text-sm">
                  + {ROLE_LABEL[role] ?? role}
                  <input
                    className="sr-only"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={busy || !canEdit}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void addReference(role, file);
                    }}
                  />
                </label>
              ))}
            </div>
          </div>
        </section>
      ) : <p className="mt-4 text-sm text-ink-secondary">Loading…</p>}
    </AppShell>
  );
}
