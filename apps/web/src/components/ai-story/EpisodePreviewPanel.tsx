"use client";

import { useMemo, useState } from "react";
import {
  AI_STORY_EPISODE_COPY,
  AI_STORY_EPISODE_ENDING_INTENTS,
  AI_STORY_EPISODE_PACING,
  describeEpisodePartialFailure,
  resolveEpisodeMomentFromTimeRange,
  type AiStoryEpisodeTimelineMoment,
} from "@ceo-agent/shared";

type Props = {
  title: string;
  durationLabel: string;
  statusLabel: string;
  videoUrl?: string | null;
  estimatedCostLabel?: string;
  actualCostLabel?: string;
  moments: readonly AiStoryEpisodeTimelineMoment[];
  readyCount: number;
  onRepairMoment: (moment: AiStoryEpisodeTimelineMoment) => void;
  onEditDialogue: (moment: AiStoryEpisodeTimelineMoment, line: string) => void;
  onAdjustEnding: (intent: string) => void;
  onAdjustPacing: (pacing: (typeof AI_STORY_EPISODE_PACING)[number]) => void;
  onExport?: () => void;
};

export function EpisodePreviewPanel({
  title,
  durationLabel,
  statusLabel,
  videoUrl,
  estimatedCostLabel,
  actualCostLabel,
  moments,
  readyCount,
  onRepairMoment,
  onEditDialogue,
  onAdjustEnding,
  onAdjustPacing,
  onExport,
}: Props) {
  const [rangeStart, setRangeStart] = useState("00:17");
  const [rangeEnd, setRangeEnd] = useState("00:24");
  const [dialogue, setDialogue] = useState("");
  const [pacing, setPacing] = useState<(typeof AI_STORY_EPISODE_PACING)[number]>("NATURAL");
  const selected = useMemo(() => {
    const parse = (value: string) => {
      const [minutes, seconds] = value.split(":").map(Number);
      return ((minutes || 0) * 60 + (seconds || 0)) * 1000;
    };
    return resolveEpisodeMomentFromTimeRange({
      startMs: parse(rangeStart),
      endMs: parse(rangeEnd),
      moments,
    });
  }, [moments, rangeEnd, rangeStart]);
  const partial = describeEpisodePartialFailure({
    readyCount,
    totalCount: moments.length,
  });

  return (
    <section className="space-y-4" data-testid="episode-preview">
      <div className="overflow-hidden rounded-2xl border border-border bg-black">
        {/* video first */}
        {videoUrl ? (
          <video className="aspect-[9/16] w-full bg-black md:aspect-video" controls src={videoUrl} aria-label="Episode Preview" />
        ) : (
          <div className="flex aspect-[9/16] items-center justify-center text-sm text-white md:aspect-video">Episode Preview will appear here</div>
        )}
      </div>
      <p className="px-1 text-xs text-ink-secondary md:hidden">Video first. Primary actions are below.</p>
      <div className="space-y-2 px-1">
        <h2 className="text-xl font-bold text-navy">{AI_STORY_EPISODE_COPY.episodePreview}</h2>
        <p className="text-sm text-navy">{title}</p>
        <p className="text-sm text-ink-secondary">{durationLabel} · {statusLabel}</p>
        <p className="text-xs text-ink-secondary">{AI_STORY_EPISODE_COPY.nativeCharacterDialogue} is preserved for visible spoken lines.</p>
        {estimatedCostLabel ? <p className="text-sm text-ink-secondary">Estimated generation cost: {estimatedCostLabel}</p> : null}
        {actualCostLabel ? <p className="text-sm font-medium text-navy">Actual generation cost: {actualCostLabel}</p> : null}
      </div>
      <div className="rounded-xl border border-border p-3" data-testid="episode-timeline">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-blue">00:00 ━━━━━━━━━━━━━━━━━━━━━ {durationLabel}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {moments.map((moment) => (
            <span key={moment.generationUnitId} className="rounded-full border border-border px-2 py-1 text-xs">{moment.marker}</span>
          ))}
        </div>
      </div>
      {partial ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950" data-testid="episode-partial-failure">
          <p>{partial}</p>
          <p className="mt-1">{AI_STORY_EPISODE_COPY.momentFailed}</p>
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">From<input className="mt-1 w-full rounded-lg border border-border px-3 py-2" value={rangeStart} onChange={(event) => setRangeStart(event.target.value)} /></label>
        <label className="text-sm">To<input className="mt-1 w-full rounded-lg border border-border px-3 py-2" value={rangeEnd} onChange={(event) => setRangeEnd(event.target.value)} /></label>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <button type="button" className="brand-btn-primary min-h-11" disabled={!selected} onClick={() => selected && onRepairMoment(selected)}>{AI_STORY_EPISODE_COPY.regenerateThisMoment}</button>
        <button type="button" className="min-h-11 rounded-lg border border-border px-4 text-sm" disabled={!selected} onClick={() => selected && onEditDialogue(selected, dialogue)}>{AI_STORY_EPISODE_COPY.editDialogue}</button>
        <button type="button" className="min-h-11 rounded-lg border border-border px-4 text-sm">{AI_STORY_EPISODE_COPY.replaceReference}</button>
        <button type="button" className="min-h-11 rounded-lg border border-border px-4 text-sm" disabled={!selected} onClick={() => selected && onRepairMoment(selected)}>{AI_STORY_EPISODE_COPY.retryFailedMoment}</button>
        {onExport ? <button type="button" className="min-h-11 rounded-lg border border-border px-4 text-sm" onClick={onExport}>{AI_STORY_EPISODE_COPY.export}</button> : null}
      </div>
      <label className="block text-sm">
        {AI_STORY_EPISODE_COPY.editDialogue}
        <textarea className="mt-1 min-h-24 w-full rounded-lg border border-border px-3 py-2" value={dialogue} onChange={(event) => setDialogue(event.target.value)} />
      </label>
      <details className="rounded-xl border border-border p-3">
        <summary className="cursor-pointer text-sm font-semibold">{AI_STORY_EPISODE_COPY.adjustEnding}</summary>
        <div className="mt-2 flex flex-wrap gap-2">
          {AI_STORY_EPISODE_ENDING_INTENTS.map((intent) => (
            <button key={intent} type="button" className="rounded-full border border-border px-3 py-1 text-sm" onClick={() => onAdjustEnding(intent)}>{intent}</button>
          ))}
        </div>
      </details>
      <details className="rounded-xl border border-border p-3">
        <summary className="cursor-pointer text-sm font-semibold">{AI_STORY_EPISODE_COPY.adjustPacing}</summary>
        <div className="mt-2 flex flex-wrap gap-2">
          {AI_STORY_EPISODE_PACING.map((value) => (
            <label key={value} className="text-sm">
              <input className="mr-1" type="radio" name="episode-pacing" checked={pacing === value} onChange={() => { setPacing(value); onAdjustPacing(value); }} />
              {value === "RELAXED" ? "Relaxed" : value === "FAST" ? "Fast" : "Natural"}
            </label>
          ))}
        </div>
      </details>
    </section>
  );
}
