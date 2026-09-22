"use client";

import { AI_STORY_REUSABLE_CHARACTER_COPY } from "@ceo-agent/shared";

type Props = {
  canonicalPreviewUrl?: string | null;
  generatedPreviewUrl?: string | null;
  onSameCharacter: () => void;
  onIdentityDrift: () => void;
};

export function CharacterIdentityReviewPanel({
  canonicalPreviewUrl,
  generatedPreviewUrl,
  onSameCharacter,
  onIdentityDrift,
}: Props) {
  return (
    <section className="rounded-2xl border border-border bg-white p-4" data-testid="character-identity-review">
      <h2 className="text-sm font-semibold text-navy">Character identity review</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <figure className="overflow-hidden rounded-xl border border-border bg-surface-muted">
          {canonicalPreviewUrl ? <img src={canonicalPreviewUrl} alt="Canonical Character reference" className="aspect-[3/4] w-full object-cover" /> : <div className="flex aspect-[3/4] items-center justify-center text-xs text-ink-secondary">Canonical Character reference</div>}
          <figcaption className="p-2 text-xs text-ink-secondary">Canonical Character reference</figcaption>
        </figure>
        <figure className="overflow-hidden rounded-xl border border-border bg-surface-muted">
          {generatedPreviewUrl ? <img src={generatedPreviewUrl} alt="Generated moment" className="aspect-[3/4] w-full object-cover" /> : <div className="flex aspect-[3/4] items-center justify-center text-xs text-ink-secondary">Generated moment</div>}
          <figcaption className="p-2 text-xs text-ink-secondary">Generated moment</figcaption>
        </figure>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="brand-btn-primary" onClick={onSameCharacter}>{AI_STORY_REUSABLE_CHARACTER_COPY.sameCharacter} ✓</button>
        <button type="button" className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-700" onClick={onIdentityDrift}>{AI_STORY_REUSABLE_CHARACTER_COPY.identityDrift} ✕</button>
      </div>
    </section>
  );
}
