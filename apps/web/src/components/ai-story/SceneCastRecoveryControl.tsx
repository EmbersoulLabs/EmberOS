"use client";

import { useMemo, useState } from "react";
import type { AiStoryCharacterAuthorityVersion, ScenePlanItem } from "@ceo-agent/shared";

type Mode = "AUTO" | "SINGLE_CHARACTER" | "MULTI_CHARACTER";
type Choice = { mode: Mode; castIds: string[]; includeExtras: boolean; extrasDescription: string; extrasCount: number };

export function SceneCastRecoveryControl({ campaignId, storyId, scenes, characters, disabled, onSaved, onError }: {
  campaignId: string;
  storyId: string;
  scenes: ScenePlanItem[];
  characters: AiStoryCharacterAuthorityVersion[];
  disabled?: boolean;
  onSaved: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const initial = useMemo(() => Object.fromEntries(scenes.map((scene) => [scene.id, {
    mode: scene.castDirection?.mode ?? "AUTO",
    castIds: scene.castDirection?.participants.map((participant) => participant.cast.id) ?? [],
    includeExtras: Boolean(scene.castDirection?.genericExtras.length),
    extrasDescription: scene.castDirection?.genericExtras[0]?.description ?? "Background passers-by",
    extrasCount: scene.castDirection?.genericExtras[0]?.count ?? 1,
  } satisfies Choice])), [scenes]);
  const [choices, setChoices] = useState<Record<string, Choice>>(initial);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");

  const update = (sceneId: string, patch: Partial<Choice>) => setChoices((current) => ({
    ...current,
    [sceneId]: { ...current[sceneId]!, ...patch },
  }));

  async function save() {
    setPending(true); setNotice(""); onError("");
    try {
      const response = await fetch(`/api/campaigns/${encodeURIComponent(campaignId)}/ai-stories/${encodeURIComponent(storyId)}/planning/cast-successor`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ scenes: scenes.map((scene) => {
          const choice = choices[scene.id]!;
          return {
            sceneId: scene.id,
            mode: choice.mode,
            participants: choice.castIds.map((castId, index) => ({
              castId,
              presence: "ON_SCREEN",
              visualRole: index === 0 ? "PRIMARY_VISUAL" : "SUPPORTING_VISUAL",
            })),
            genericExtras: choice.includeExtras ? [{ description: choice.extrasDescription, count: choice.extrasCount, facesReadable: false }] : [],
          };
        }) }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Scene cast successor could not be created");
      setNotice("Scene cast successor created with zero AI calls. Review Planning before approval.");
      await onSaved();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Scene cast successor could not be created");
    } finally { setPending(false); }
  }

  return <section className="space-y-3 rounded-xl border border-border p-4" data-testid="scene-cast-recovery">
    <div><h3 className="text-sm font-semibold text-navy">Scene cast direction</h3><p className="text-xs text-ink-secondary">Choose AUTO, one identified Character, multiple identified Characters, or anonymous extras per Scene. Anonymous extras do not require Character DNA.</p></div>
    {scenes.map((scene) => { const choice = choices[scene.id]!; return <div key={scene.id} className="space-y-2 rounded-lg bg-slate-50 p-3">
      <p className="text-sm font-medium text-navy">Scene {scene.order + 1}: {scene.purpose}</p>
      <select value={choice.mode} onChange={(event) => update(scene.id, { mode: event.target.value as Mode, castIds: [] })} className="rounded-lg border border-border bg-white px-3 py-2 text-sm" aria-label={`Scene ${scene.order + 1} cast mode`}>
        <option value="AUTO">AUTO</option><option value="SINGLE_CHARACTER">Single identified Character</option><option value="MULTI_CHARACTER">Multiple people</option>
      </select>
      {choice.mode !== "AUTO" ? <div className="grid gap-1">{characters.map((character) => <label key={character.characterId} className="flex items-center gap-2 text-sm"><input type={choice.mode === "SINGLE_CHARACTER" ? "radio" : "checkbox"} name={`cast-${scene.id}`} checked={choice.castIds.includes(character.characterId)} onChange={(event) => update(scene.id, { castIds: choice.mode === "SINGLE_CHARACTER" ? (event.target.checked ? [character.characterId] : []) : event.target.checked ? [...choice.castIds, character.characterId] : choice.castIds.filter((id) => id !== character.characterId) })}/>{character.name}</label>)}</div> : null}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={choice.includeExtras} onChange={(event) => update(scene.id, { includeExtras: event.target.checked })}/>Anonymous passers-by / extras</label>
      {choice.includeExtras ? <div className="flex gap-2"><input value={choice.extrasDescription} onChange={(event) => update(scene.id, { extrasDescription: event.target.value })} className="min-w-0 flex-1 rounded-lg border border-border px-3 py-2 text-sm" aria-label="Extras description"/><input type="number" min={1} max={100} value={choice.extrasCount} onChange={(event) => update(scene.id, { extrasCount: Number(event.target.value) })} className="w-20 rounded-lg border border-border px-3 py-2 text-sm" aria-label="Extras count"/></div> : null}
    </div>; })}
    <button type="button" disabled={disabled || pending} onClick={() => void save()} className="rounded-lg border border-primary px-3 py-2 text-sm font-medium text-primary disabled:opacity-60">{pending ? "Creating successor…" : "Create cast successor for review"}</button>
    {notice ? <p className="text-sm text-green-700">{notice}</p> : null}
  </section>;
}
