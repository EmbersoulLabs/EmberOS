"use client";

import { useEffect, useState } from "react";
import type { AiStoryEpisodeTimelineMoment } from "@ceo-agent/shared";
import { VOICE_CONTINUITY_STATUS } from "@ceo-agent/shared";

type Props = {
  moments: readonly AiStoryEpisodeTimelineMoment[];
  visible: boolean;
  revisionRequest?: Record<string, unknown> | null;
  campaignId?: string;
  storyId?: string;
};

export function EpisodeDebugPanel({ moments, visible, revisionRequest, campaignId, storyId }: Props) {
  const [lineage, setLineage] = useState<unknown[] | null>(null);
  useEffect(() => {
    if (!visible || !campaignId || !storyId) return;
    let cancelled = false;
    void fetch(`/api/campaigns/${campaignId}/ai-stories/${storyId}/character-lineage`)
      .then(async (response) => ({ ok: response.ok, body: await response.json() }))
      .then(({ ok, body }) => {
        if (!cancelled && ok) setLineage(body.lineage ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [visible, campaignId, storyId]);
  if (!visible) return null;
  return (
    <details className="rounded-2xl border border-border bg-white p-4" data-testid="episode-super-admin-diagnostics">
      <summary className="cursor-pointer text-sm font-semibold text-navy">Super Admin diagnostics</summary>
      <div className="mt-3 space-y-2 text-xs text-ink-secondary">
        <p>Scenes, Shots, and Generation Units remain internal execution authorities.</p>
        <p data-testid="voice-continuity-status">VOICE_CONTINUITY_STATUS = {VOICE_CONTINUITY_STATUS}</p>
        <ul className="space-y-1">
          {moments.map((moment) => (
            <li key={moment.generationUnitId}>
              {moment.marker}: Scene {moment.sceneOrder + 1} / Shot {moment.directorShotId.slice(-4)} / Generation Units {moment.generationUnitId.slice(-4)}
            </li>
          ))}
        </ul>
        {lineage?.length ? (
          <div data-testid="reusable-character-lineage">{JSON.stringify(lineage)}</div>
        ) : null}
        {revisionRequest ? (
          <div className="mt-3 space-y-1" data-testid="episode-revision-diagnostics">
            <p>revisionRequest {JSON.stringify(revisionRequest)}</p>
          </div>
        ) : null}
      </div>
    </details>
  );
}
