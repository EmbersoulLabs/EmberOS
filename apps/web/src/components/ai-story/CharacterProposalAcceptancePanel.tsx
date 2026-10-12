"use client";

import { useState } from "react";
import type { AiStoryCharacterAuthorityVersion, AiStoryCharacterMutationInput, CreativeContext } from "@ceo-agent/shared";

type Proposal = CreativeContext["characterContext"]["characters"][number];

const emptyFacts = (proposal: Proposal): AiStoryCharacterMutationInput => ({
  name: proposal.name,
  identity: proposal.description.trim() || proposal.name,
  appearance: proposal.visualNotes.trim() || "No reference image.",
  personality: proposal.motivation.trim() || "As confirmed by the operator.",
  emotionalArc: "As confirmed by the operator.",
  relationships: [],
  visualAssetIds: [],
});

export function CharacterProposalAcceptancePanel({
  campaignId,
  storyId,
  proposals,
  characters,
  disabled,
  onAccepted,
  onError,
}: {
  campaignId: string;
  storyId: string;
  proposals: readonly Proposal[];
  characters: readonly AiStoryCharacterAuthorityVersion[];
  disabled?: boolean;
  onAccepted: () => Promise<void> | void;
  onError: (message: string) => void;
}) {
  const [selectedKey, setSelectedKey] = useState(proposals[0]?.id ?? "");
  const selected = proposals.find((proposal) => proposal.id === selectedKey) ?? proposals[0];
  const [facts, setFacts] = useState<AiStoryCharacterMutationInput>(selected ? emptyFacts(selected) : {
    name: "", identity: "", appearance: "", personality: "", emotionalArc: "", relationships: [], visualAssetIds: [],
  });
  const [existingCharacterId, setExistingCharacterId] = useState("");
  const [busy, setBusy] = useState(false);
  if (!selected?.id) return null;

  function choose(proposal: Proposal) {
    setSelectedKey(proposal.id ?? "");
    setFacts(emptyFacts(proposal));
    setExistingCharacterId("");
  }

  async function accept() {
    if (!selected?.id) return;
    setBusy(true);
    onError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/ai-stories/${storyId}/character-proposals/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(existingCharacterId
          ? { proposalKey: selected.id, characterId: existingCharacterId }
          : { proposalKey: selected.id, character: facts }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Character could not be authorized");
      await onAccepted();
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "Character could not be authorized");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-border p-4" data-testid="character-proposal-acceptance">
      <h3 className="text-sm font-semibold text-navy">Authorize original Character</h3>
      <p className="mt-1 text-sm text-ink-secondary">A short Story prompt can propose a person, but that proposal is not authority. Confirm the facts before Scene planning freezes the Outline. A reference image is optional.</p>
      <div className="mt-3 grid gap-3">
        {proposals.length > 1 ? (
          <label className="block space-y-1">
            <span className="text-sm font-medium text-navy">Proposal</span>
            <select className="w-full rounded-lg border border-border px-3 py-2 text-sm" value={selected.id} onChange={(event) => {
              const proposal = proposals.find((item) => item.id === event.target.value);
              if (proposal) choose(proposal);
            }}>
              {proposals.filter((proposal) => proposal.id).map((proposal) => <option key={proposal.id} value={proposal.id}>{proposal.name}</option>)}
            </select>
          </label>
        ) : <p className="text-sm text-navy">{selected.name}</p>}
        {(["name", "identity", "appearance", "personality", "emotionalArc"] as const).map((key) => (
          <label key={key} className="block space-y-1">
            <span className="text-sm font-medium text-navy">{key === "emotionalArc" ? "Emotional arc" : key[0]!.toUpperCase() + key.slice(1)}</span>
            {key === "name"
              ? <input className="w-full rounded-lg border border-border px-3 py-2 text-sm" value={facts[key]} onChange={(event) => setFacts({ ...facts, [key]: event.target.value })} />
              : <textarea className="min-h-16 w-full rounded-lg border border-border px-3 py-2 text-sm" value={facts[key]} onChange={(event) => setFacts({ ...facts, [key]: event.target.value })} />}
          </label>
        ))}
        <label className="block space-y-1">
          <span className="text-sm font-medium text-navy">Or bind an existing Campaign Character</span>
          <select className="w-full rounded-lg border border-border px-3 py-2 text-sm" value={existingCharacterId} onChange={(event) => setExistingCharacterId(event.target.value)}>
            <option value="">Create a new Character from the facts above</option>
            {characters.map((character) => <option key={character.characterId} value={character.characterId}>{character.name}</option>)}
          </select>
        </label>
        <button type="button" className="brand-btn-primary" disabled={disabled || busy} onClick={() => void accept()}>{busy ? "Authorizing…" : "Authorize Character"}</button>
      </div>
    </section>
  );
}
