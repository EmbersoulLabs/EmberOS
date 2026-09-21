"use client";

import { useMemo, useState } from "react";
import {
  AI_STORY_EPISODE_ACTION_CERTIFICATION,
  AI_STORY_EPISODE_COPY,
  AI_STORY_EPISODE_ENDING_INTENTS,
  AI_STORY_EPISODE_PACING,
  BACKEND_GAP,
  classifyEpisodeMomentRepair,
  describeEpisodePartialFailure,
  resolveEpisodeMomentFromTimeRange,
  type AiStoryEpisodeTimelineMoment,
} from "@ceo-agent/shared";

type Props = {
  title: string;
  durationLabel: string;
  statusLabel: string;
  videoUrl?: string | null;
  actualCostLabel?: string;
  moments: readonly AiStoryEpisodeTimelineMoment[];
  readyCount: number;
  onRepairMoment: (moment: AiStoryEpisodeTimelineMoment) => void;
};

export function EpisodePreviewPanel({
  title,
  durationLabel,
  statusLabel,
  videoUrl,
  actualCostLabel,
  moments,
  readyCount,
  onRepairMoment,
}: Props) {
  const [rangeStart, setRangeStart] = useState("00:17");
  const [rangeEnd, setRangeEnd] = useState("00:24");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(() => {
    const byId = moments.find((moment) => moment.generationUnitId === selectedId);
    if (byId) return byId;
    const recorded = moments.filter((moment) => moment.timeRangeAuthority === "RECORDED");
    if (!recorded.length) return null;
    const parse = (value: string) => {
      const [minutes, seconds] = value.split(":").map(Number);
      return ((minutes || 0) * 60 + (seconds || 0)) * 1000;
    };
    return resolveEpisodeMomentFromTimeRange({
      startMs: parse(rangeStart),
      endMs: parse(rangeEnd),
      moments: recorded,
    });
  }, [moments, rangeEnd, rangeStart, selectedId]);
  const repair = selected
    ? classifyEpisodeMomentRepair({
        runtimeState: selected.runtimeState,
        retryAuthorizationId: selected.retryAuthorizationId,
        sceneExecutionId: selected.generationUnitId,
      })
    : null;
  const canRepair = repair?.kind === "PRE_DISPATCH_RECOVERY" || repair?.kind === "RETRY_AUTHORIZED";
  const partial = describeEpisodePartialFailure({
    readyCount,
    totalCount: moments.length,
  });
  const hasRecordedTimeRange = moments.some((moment) => moment.timeRangeAuthority === "RECORDED");

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
        <p className="text-sm text-ink-secondary" data-testid="episode-cost-estimate-gap">{AI_STORY_EPISODE_COPY.costEstimateUnavailable}</p>
        {actualCostLabel ? <p className="text-sm font-medium text-navy">Actual generation cost: {actualCostLabel}</p> : null}
      </div>
      <div className="rounded-xl border border-border p-3" data-testid="episode-timeline">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-blue">00:00 ━━━━━━━━━━━━━━━━━━━━━ {durationLabel}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {moments.map((moment) => (
            <button
              key={moment.generationUnitId}
              type="button"
              className={`rounded-full border px-2 py-1 text-xs ${selected?.generationUnitId === moment.generationUnitId ? "border-brand-blue bg-brand-blue/10" : "border-border"}`}
              onClick={() => setSelectedId(moment.generationUnitId)}
            >
              {moment.marker}
            </button>
          ))}
        </div>
      </div>
      {partial ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950" data-testid="episode-partial-failure">
          <p>{partial}</p>
          <p className="mt-1">{AI_STORY_EPISODE_COPY.momentFailed}</p>
        </div>
      ) : null}
      {hasRecordedTimeRange ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">From<input className="mt-1 w-full rounded-lg border border-border px-3 py-2" value={rangeStart} onChange={(event) => { setSelectedId(null); setRangeStart(event.target.value); }} /></label>
          <label className="text-sm">To<input className="mt-1 w-full rounded-lg border border-border px-3 py-2" value={rangeEnd} onChange={(event) => { setSelectedId(null); setRangeEnd(event.target.value); }} /></label>
        </div>
      ) : (
        <p className="text-xs text-ink-secondary" data-testid="episode-time-range-gap">Time-range mapping waits for recorded Editorial windows. Select a moment marker to use existing Scene retry identity.</p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <button type="button" className="brand-btn-primary min-h-11" disabled={!canRepair} onClick={() => selected && canRepair && onRepairMoment(selected)}>{AI_STORY_EPISODE_COPY.regenerateThisMoment}</button>
        <button type="button" className="min-h-11 rounded-lg border border-border px-4 text-sm" disabled={!canRepair} onClick={() => selected && canRepair && onRepairMoment(selected)}>{AI_STORY_EPISODE_COPY.retryFailedMoment}</button>
        <button type="button" className="min-h-11 rounded-lg border border-border px-4 text-sm" disabled data-testid="episode-edit-dialogue-gap">{AI_STORY_EPISODE_COPY.editDialogue}</button>
        <button type="button" className="min-h-11 rounded-lg border border-border px-4 text-sm" disabled data-testid="episode-replace-reference-gap">{AI_STORY_EPISODE_COPY.replaceReference}</button>
      </div>
      {repair?.kind === BACKEND_GAP && selected ? (
        <p className="text-sm text-amber-800" data-testid="episode-regenerate-gap">{repair.reason}</p>
      ) : null}
      <p className="text-xs text-ink-secondary" data-testid="episode-backend-gap">{AI_STORY_EPISODE_COPY.backendGap} {AI_STORY_EPISODE_ACTION_CERTIFICATION.editDialogue}</p>
      <details className="rounded-xl border border-border p-3">
        <summary className="cursor-pointer text-sm font-semibold">{AI_STORY_EPISODE_COPY.adjustEnding}</summary>
        <div className="mt-2 flex flex-wrap gap-2">
          {AI_STORY_EPISODE_ENDING_INTENTS.map((intent) => (
            <button key={intent} type="button" className="rounded-full border border-border px-3 py-1 text-sm" disabled data-testid="episode-adjust-ending-gap">{intent}</button>
          ))}
        </div>
        <p className="mt-2 text-xs text-ink-secondary">{AI_STORY_EPISODE_ACTION_CERTIFICATION.adjustEnding}</p>
      </details>
      <details className="rounded-xl border border-border p-3">
        <summary className="cursor-pointer text-sm font-semibold">{AI_STORY_EPISODE_COPY.adjustPacing}</summary>
        <div className="mt-2 flex flex-wrap gap-2">
          {AI_STORY_EPISODE_PACING.map((value) => (
            <label key={value} className="text-sm text-ink-secondary">
              <input className="mr-1" type="radio" name="episode-pacing" disabled />
              {value === "RELAXED" ? "Relaxed" : value === "FAST" ? "Fast" : "Natural"}
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-ink-secondary" data-testid="episode-adjust-pacing-gap">{AI_STORY_EPISODE_ACTION_CERTIFICATION.adjustPacing}</p>
      </details>
    </section>
  );
}
