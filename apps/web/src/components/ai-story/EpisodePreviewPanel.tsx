"use client";

import { useMemo, useState } from "react";
import {
  AI_STORY_EPISODE_COPY,
  AI_STORY_EPISODE_ENDING_INTENTS,
  AI_STORY_EPISODE_PACING,
  BACKEND_GAP,
  aiStoryEpisodeRevisionCapability,
  classifyEpisodeMomentRepair,
  describeEpisodePartialFailure,
  resolveEpisodeMomentFromTimeRange,
  revisionActionEnabled,
  type AiStoryEpisodePacing,
  type AiStoryEpisodeRevisionCapability,
  type AiStoryEpisodeTimelineMoment,
} from "@ceo-agent/shared";

type HistoryEntry = { version: number; summary: string };

type Props = {
  title: string;
  durationLabel: string;
  statusLabel: string;
  videoUrl?: string | null;
  actualCostLabel?: string;
  liveCostLabel?: string;
  moments: readonly AiStoryEpisodeTimelineMoment[];
  readyCount: number;
  onRepairMoment: (moment: AiStoryEpisodeTimelineMoment) => void;
  campaignId?: string;
  storyId?: string;
  revisionCapability?: AiStoryEpisodeRevisionCapability;
  revisionHistory?: readonly HistoryEntry[];
  revisionStatusLabel?: string;
  revisionSaved?: boolean;
  regenerationCostLabel?: string;
  currentVersionLabel?: string;
  previousVersionLabel?: string;
  onEditDialogue?: (moment: AiStoryEpisodeTimelineMoment, nextText: string) => void;
  onAdjustEnding?: (intent: (typeof AI_STORY_EPISODE_ENDING_INTENTS)[number]) => void;
  onAdjustPacing?: (pacing: AiStoryEpisodePacing) => void;
  onReplaceReference?: (moment: AiStoryEpisodeTimelineMoment) => void;
  onAuthorizeRegeneration?: () => void;
};

export function EpisodePreviewPanel({
  title,
  durationLabel,
  statusLabel,
  videoUrl,
  actualCostLabel,
  liveCostLabel,
  moments,
  readyCount,
  onRepairMoment,
  campaignId,
  storyId,
  revisionCapability = aiStoryEpisodeRevisionCapability(),
  revisionHistory = [],
  revisionStatusLabel,
  revisionSaved,
  regenerationCostLabel,
  currentVersionLabel,
  previousVersionLabel,
  onEditDialogue,
  onAdjustEnding,
  onAdjustPacing,
  onReplaceReference,
  onAuthorizeRegeneration,
}: Props) {
  const [rangeStart, setRangeStart] = useState("00:17");
  const [rangeEnd, setRangeEnd] = useState("00:24");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialogueDraft, setDialogueDraft] = useState("");
  const [pacing, setPacing] = useState<AiStoryEpisodePacing>("NATURAL");
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
  const revisionEndpoint =
    campaignId && storyId
      ? `/api/campaigns/${campaignId}/ai-stories/${storyId}/episode-revisions`
      : "episode-revisions";
  const canEditDialogue =
    revisionActionEnabled("EDIT_DIALOGUE", revisionCapability) && Boolean(onEditDialogue) && Boolean(selected);
  const canReplaceReference =
    revisionActionEnabled("REPLACE_REFERENCE", revisionCapability) &&
    Boolean(onReplaceReference) &&
    Boolean(selected);
  const canAdjustEnding =
    revisionActionEnabled("ADJUST_ENDING", revisionCapability) && Boolean(onAdjustEnding);
  const canAdjustPacing =
    revisionActionEnabled("ADJUST_PACING", revisionCapability) && Boolean(onAdjustPacing);

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
        {liveCostLabel ? (
          <p className="text-sm font-medium text-navy" data-testid="episode-cost-estimate">
            {AI_STORY_EPISODE_COPY.estimatedCost}: {liveCostLabel}
          </p>
        ) : (
          <p className="text-sm text-ink-secondary" data-testid="episode-cost-estimate-gap">{AI_STORY_EPISODE_COPY.costEstimateUnavailable}</p>
        )}
        {actualCostLabel ? <p className="text-sm font-medium text-navy">Actual generation cost: {actualCostLabel}</p> : null}
        {revisionStatusLabel ? (
          <p className="text-sm text-ink-secondary" data-testid="episode-revision-status">{revisionStatusLabel}</p>
        ) : null}
        {currentVersionLabel ? (
          <p className="text-sm text-navy" data-testid="episode-current-version">{currentVersionLabel}</p>
        ) : null}
        {previousVersionLabel ? (
          <p className="text-xs text-ink-secondary" data-testid="episode-previous-version">{previousVersionLabel}</p>
        ) : null}
        {revisionSaved ? (
          <div className="rounded-xl border border-border p-3" data-testid="episode-revision-saved">
            <p className="text-sm font-medium text-navy">{AI_STORY_EPISODE_COPY.revisionSaved}</p>
            {regenerationCostLabel ? (
              <p className="mt-1 text-sm text-navy" data-testid="episode-revision-regeneration-cost">
                {AI_STORY_EPISODE_COPY.estimatedRegenerationCost}: {regenerationCostLabel}
              </p>
            ) : null}
            <button
              type="button"
              className="mt-2 min-h-11 rounded-lg border border-border px-4 text-sm"
              data-testid="episode-authorize-regeneration"
              onClick={() => onAuthorizeRegeneration?.()}
            >
              {AI_STORY_EPISODE_COPY.authorizeRegeneration}
            </button>
          </div>
        ) : null}
      </div>
      <div className="rounded-xl border border-border p-3" data-testid="episode-timeline">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-blue">00:00 ━━━━━━━━━━━━━━━━━━━━━ {durationLabel}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {moments.map((moment) => (
            <button
              key={moment.generationUnitId}
              type="button"
              className={`rounded-full border px-2 py-1 text-xs ${selected?.generationUnitId === moment.generationUnitId ? "border-brand-blue bg-brand-blue/10" : "border-border"}`}
              onClick={() => {
                setSelectedId(moment.generationUnitId);
                setDialogueDraft(moment.dialogueLine ?? "");
              }}
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
      {canEditDialogue ? (
        <label className="block text-sm">
          {AI_STORY_EPISODE_COPY.editDialogue}
          <input
            className="mt-1 w-full rounded-lg border border-border px-3 py-2"
            value={dialogueDraft}
            onChange={(event) => setDialogueDraft(event.target.value)}
            data-testid="episode-edit-dialogue-input"
          />
        </label>
      ) : null}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <button type="button" className="brand-btn-primary min-h-11" disabled={!canRepair} onClick={() => selected && canRepair && onRepairMoment(selected)}>{AI_STORY_EPISODE_COPY.regenerateThisMoment}</button>
        <button type="button" className="min-h-11 rounded-lg border border-border px-4 text-sm" disabled={!canRepair} onClick={() => selected && canRepair && onRepairMoment(selected)}>{AI_STORY_EPISODE_COPY.retryFailedMoment}</button>
        <button
          type="button"
          className="min-h-11 rounded-lg border border-border px-4 text-sm"
          disabled={!canEditDialogue || !dialogueDraft.trim()}
          data-testid="episode-edit-dialogue"
          onClick={() => selected && onEditDialogue?.(selected, dialogueDraft.trim())}
        >
          {AI_STORY_EPISODE_COPY.editDialogue}
        </button>
        <button
          type="button"
          className="min-h-11 rounded-lg border border-border px-4 text-sm"
          disabled={!canReplaceReference}
          data-testid="episode-replace-reference"
          onClick={() => selected && onReplaceReference?.(selected)}
        >
          {AI_STORY_EPISODE_COPY.replaceReference}
        </button>
      </div>
      {repair?.kind === BACKEND_GAP && selected ? (
        <p className="text-sm text-amber-800" data-testid="episode-regenerate-gap">{repair.reason}</p>
      ) : null}
      <p className="text-xs text-ink-secondary" data-testid="episode-revision-endpoint">
        Revision actions POST {revisionEndpoint}. Estimates do not authorize spend.
      </p>
      <details className="rounded-xl border border-border p-3">
        <summary className="cursor-pointer text-sm font-semibold">{AI_STORY_EPISODE_COPY.adjustEnding}</summary>
        <div className="mt-2 flex flex-wrap gap-2">
          {AI_STORY_EPISODE_ENDING_INTENTS.map((intent) => (
            <button
              key={intent}
              type="button"
              className="rounded-full border border-border px-3 py-1 text-sm"
              disabled={!canAdjustEnding}
              data-testid="episode-adjust-ending"
              onClick={() => onAdjustEnding?.(intent)}
            >
              {intent}
            </button>
          ))}
        </div>
      </details>
      <details className="rounded-xl border border-border p-3">
        <summary className="cursor-pointer text-sm font-semibold">{AI_STORY_EPISODE_COPY.adjustPacing}</summary>
        <div className="mt-2 flex flex-wrap gap-2">
          {AI_STORY_EPISODE_PACING.map((value) => (
            <label key={value} className="text-sm text-ink-secondary">
              <input
                className="mr-1"
                type="radio"
                name="episode-pacing"
                checked={pacing === value}
                disabled={!canAdjustPacing}
                onChange={() => {
                  setPacing(value);
                  onAdjustPacing?.(value);
                }}
              />
              {value === "RELAXED" ? "Relaxed" : value === "FAST" ? "Fast" : "Natural"}
            </label>
          ))}
        </div>
      </details>
      {revisionHistory.length ? (
        <div className="rounded-xl border border-border p-3" data-testid="episode-revision-history">
          <p className="text-sm font-semibold">{AI_STORY_EPISODE_COPY.revisionHistory}</p>
          <ul className="mt-2 space-y-1 text-sm text-ink-secondary">
            {revisionHistory.map((entry) => (
              <li key={entry.version}>Version {entry.version}: {entry.summary}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
