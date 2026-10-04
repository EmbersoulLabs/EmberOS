"use client";

import { useState } from "react";
import {
  VISUAL_STYLE_AUTHORITY_VERSION,
  COVER_COMPOSITION_AUTHORITY_VERSION,
  VISUAL_STYLE_PRESETS,
  type VisualStylePreset,
} from "@ceo-agent/shared";

export function VisualStyleAuthorityPreview({
  storyId,
  storyVersionId,
  storyVersionNumber,
}: {
  storyId: string;
  storyVersionId: string;
  storyVersionNumber: number;
}) {
  const [presetId, setPresetId] = useState(VISUAL_STYLE_PRESETS[0]!.id);
  const preset =
    VISUAL_STYLE_PRESETS.find((candidate) => candidate.id === presetId) ??
    VISUAL_STYLE_PRESETS[0]!;

  return (
    <section
      className="space-y-4 rounded-2xl border border-border bg-white p-5"
      data-testid="visual-style-authority-preview"
    >
      <div>
        <h2 className="text-lg font-bold text-navy">Visual Style &amp; Cover Authority</h2>
        <p className="mt-1 text-sm text-ink-secondary">
          Preview provider-neutral style and cover rules for Story version{" "}
          {storyVersionNumber}. Identity authority remains separate and takes precedence.
        </p>
      </div>

      <label className="block space-y-1">
        <span className="text-sm font-medium text-navy">Style preset</span>
        <select
          className="w-full rounded-lg border border-border px-3 py-2 text-sm"
          value={preset.id}
          onChange={(event) => setPresetId(event.target.value)}
        >
          {VISUAL_STYLE_PRESETS.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.label}
            </option>
          ))}
        </select>
      </label>

      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
        <div className="space-y-3">
          <div>
            <p className="text-sm font-semibold text-navy">{preset.label}</p>
            <p className="text-xs text-ink-secondary">{preset.description}</p>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            <Rule label="Palette" value={preset.style.paletteBehavior} />
            <Rule label="Lighting" value={preset.style.lighting} />
            <Rule label="Texture" value={preset.style.texture} />
            <Rule label="Contrast" value={preset.style.contrast} />
            <Rule label="Rhythm" value={preset.style.compositionRhythm} />
            <Rule label="Space" value={preset.style.negativeSpace} />
          </dl>
          <p className="text-xs text-ink-secondary">
            Bound preview: {shortId(storyId)} / {shortId(storyVersionId)}
          </p>
        </div>
        <CoverPreview preset={preset} />
      </div>

      <p className="border-t border-border pt-3 text-xs text-ink-secondary">
        Contracts: {VISUAL_STYLE_AUTHORITY_VERSION} ·{" "}
        {COVER_COMPOSITION_AUTHORITY_VERSION}. Preview only; no generation is queued.
      </p>
    </section>
  );
}

function CoverPreview({ preset }: { preset: VisualStylePreset }) {
  const textAlignment =
    preset.cover.textZone === "right" ? "text-right" : "text-left";
  return (
    <div
      className={`flex min-h-48 flex-col justify-between rounded-xl border border-slate-300 bg-gradient-to-br from-slate-900 via-slate-700 to-slate-500 p-4 text-white ${textAlignment}`}
      aria-label={`Cover composition preview, ${preset.cover.aspectRatio}`}
    >
      <span className="text-[10px] uppercase tracking-widest opacity-80">
        {preset.cover.aspectRatio} · {preset.cover.focalPlacement.replace("_", " ")}
      </span>
      <div>
        <p className="text-lg font-bold leading-tight">Story headline</p>
        <p className="mt-1 text-[10px] opacity-80">
          {preset.cover.textZone} text · {preset.cover.legibility.replace("_", " ")}
        </p>
      </div>
    </div>
  );
}

function Rule({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-ink-secondary">{label}</dt>
      <dd className="font-medium capitalize text-navy">{value.replace("_", " ")}</dd>
    </div>
  );
}

function shortId(value: string): string {
  return `${value.slice(0, 8)}…`;
}
