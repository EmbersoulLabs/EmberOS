"use client";

import {
  summarizeCharacterReferencePackSurface,
  type AiStoryCharacterReferencePack,
  type AiStoryReusableCharacterVersion,
  type CharacterReferencePackSurfaceView,
} from "@ceo-agent/shared";
import { CharacterPortrait } from "./CharacterPortrait";

function ViewList({
  title,
  views,
  testId,
  workspaceId,
}: {
  title: string;
  views: CharacterReferencePackSurfaceView[];
  testId: string;
  workspaceId: string;
}) {
  return (
    <div data-testid={testId}>
      <h3 className="mt-3 text-sm font-medium text-navy">{title}</h3>
      {views.length === 0 ? <p className="mt-1 text-xs text-ink-secondary">None</p> : null}
      <ul className="mt-2 grid gap-2">
        {views.map((view) => (
          <li key={view.viewId} className="flex items-center gap-3 text-sm">
            <CharacterPortrait
              workspaceId={workspaceId}
              assetId={view.assetId}
              label={view.role}
              className="h-14 w-14 rounded-md object-cover"
            />
            <span>
              <span className="font-medium text-navy">{view.role}</span>
              <span className="ml-2 text-ink-secondary">{view.status}</span>
              <span className="ml-2 text-ink-secondary">lineage {view.lineageIndex}{view.current ? " · current" : ""}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CharacterReferencePackPanel({
  workspaceId,
  character,
  pack = null,
}: {
  workspaceId: string;
  character: Pick<
    AiStoryReusableCharacterVersion,
    | "identityMode"
    | "characterConsistencyMode"
    | "canonicalAssets"
    | "reusableCharacterId"
    | "reusableCharacterVersionId"
    | "identityFingerprint"
  >;
  pack?: AiStoryCharacterReferencePack | null;
}) {
  const summary = summarizeCharacterReferencePackSurface({ character, pack });
  return (
    <section className="rounded-xl border border-border p-4" data-testid="character-reference-pack-panel">
      <h2 className="text-sm font-semibold text-navy">Character reference pack</h2>
      <p className="mt-1 text-xs text-ink-secondary">
        Derived views bind to this Character version. They do not create a new Character version.
      </p>
      <h3 className="mt-3 text-sm font-medium text-navy">Canonical anchor</h3>
      {summary.anchor ? (
        <div className="mt-2 flex items-center gap-3" data-testid="reference-pack-anchor">
          <CharacterPortrait
            workspaceId={workspaceId}
            assetId={summary.anchor.assetId}
            label={summary.anchor.label}
            className="h-16 w-16 rounded-md object-cover"
          />
          <p className="text-sm text-navy">{summary.anchor.label}</p>
        </div>
      ) : (
        <p className="mt-2 text-sm text-ink-secondary" data-testid="reference-pack-anchor-required">
          {summary.anchorBlockCode}
        </p>
      )}
      {summary.sourcePortraitAssetId ? (
        <p className="mt-2 text-xs text-ink-secondary">Source photo remains provenance only.</p>
      ) : null}
      <ViewList title="Approved views" views={summary.approved} testId="reference-pack-approved" workspaceId={workspaceId} />
      <ViewList title="Pending views" views={summary.pending} testId="reference-pack-pending" workspaceId={workspaceId} />
      <ViewList title="Stale views" views={summary.stale} testId="reference-pack-stale" workspaceId={workspaceId} />
    </section>
  );
}
