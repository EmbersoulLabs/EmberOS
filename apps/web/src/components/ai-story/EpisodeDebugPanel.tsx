"use client";

import type { AiStoryEpisodeTimelineMoment } from "@ceo-agent/shared";

type Props = {
  moments: readonly AiStoryEpisodeTimelineMoment[];
  visible: boolean;
  revisionRequest?: Record<string, unknown> | null;
};

export function EpisodeDebugPanel({ moments, visible, revisionRequest }: Props) {
  if (!visible) return null;
  return (
    <details className="rounded-2xl border border-border bg-white p-4" data-testid="episode-super-admin-diagnostics">
      <summary className="cursor-pointer text-sm font-semibold text-navy">Super Admin diagnostics</summary>
      <div className="mt-3 space-y-2 text-xs text-ink-secondary">
        <p>Scenes, Shots, and Generation Units remain internal execution authorities.</p>
        <ul className="space-y-1">
          {moments.map((moment) => (
            <li key={moment.generationUnitId}>
              {moment.marker}: Scene {moment.sceneOrder + 1} / Shot {moment.directorShotId.slice(-4)} / Generation Units {moment.generationUnitId.slice(-4)}
            </li>
          ))}
        </ul>
        {revisionRequest ? (
          <div className="mt-3 space-y-1" data-testid="episode-revision-diagnostics">
            <p>revisionRequest {JSON.stringify(revisionRequest)}</p>
          </div>
        ) : null}
      </div>
    </details>
  );
}
