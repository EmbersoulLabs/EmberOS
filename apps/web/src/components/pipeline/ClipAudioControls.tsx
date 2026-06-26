"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  readCreativeAudioSettings,
  getBgmPickerOptions,
  getBgmTrackById,
  type ClipBgmKey,
  type ClipVoicePreset,
  type EditPlan,
  type RenderPhase,
} from "@ceo-agent/shared";
import type { TranslationKey } from "@ceo-agent/shared/i18n";
import { useI18n } from "@/lib/i18n/provider";
import { BgmStartWaveform } from "@/components/pipeline/BgmStartWaveform";

const PHASE_KEYS: Record<RenderPhase, TranslationKey> = {
  queued: "creative.audio.phase.queued",
  downloading: "creative.audio.phase.downloading",
  base_clip: "creative.audio.phase.base_clip",
  subtitles: "creative.audio.phase.subtitles",
  upload: "creative.audio.phase.upload",
  done: "creative.audio.phase.done",
};

const APPLY_DEBOUNCE_MS = 650;

type LiveProgress = {
  percent?: number;
  phase?: string;
  error?: string;
};

type MusicSearchResult = {
  source: "jamendo";
  trackId: string;
  name: string;
  artist: string;
  durationSec: number;
  previewUrl: string;
  audioUrl: string;
  licenseUrl: string;
  attribution: string;
  image?: string;
};

export function ClipAudioControls({
  creativeId,
  editPlan,
  renderStatus,
  renderProgress,
  compact = false,
  onRerenderStart,
  onRenderComplete,
}: {
  creativeId: string;
  editPlan: EditPlan | null | undefined;
  renderStatus?: string;
  renderProgress?: LiveProgress | null;
  compact?: boolean;
  onRerenderStart?: () => void;
  onRenderComplete?: () => void;
}) {
  const { t } = useI18n();
  const initial = readCreativeAudioSettings(editPlan ?? null);
  const bgmOptions = useMemo(() => {
    const distinct = getBgmPickerOptions();
    const current = getBgmTrackById(initial.bgm);
    if (current && !distinct.some((track) => track.trackId === current.id)) {
      return [
        {
          trackId: current.id,
          trackName: current.name,
          previewUrl: current.fileUrl,
          category: current.category,
          mood: current.mood,
        },
        ...distinct,
      ];
    }
    return distinct;
  }, [initial.bgm]);

  const [bgm, setBgm] = useState<ClipBgmKey>(initial.bgm);
  const [voicePreset, setVoicePreset] = useState<ClipVoicePreset>(initial.voicePreset);
  const [ttsLocale, setTtsLocale] = useState<"en" | "zh">(initial.ttsLocale ?? "en");
  const [saving, setSaving] = useState(false);
  const [awaitingRender, setAwaitingRender] = useState(false);
  const [error, setError] = useState("");
  const [live, setLive] = useState<LiveProgress>(() => renderProgress ?? {});
  const [bgmStartOffset, setBgmStartOffset] = useState(initial.bgmStartOffsetSec);
  const [savedBgmStartOffset, setSavedBgmStartOffset] = useState(initial.bgmStartOffsetSec);
  const [applyingStart, setApplyingStart] = useState(false);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [showOnline, setShowOnline] = useState(false);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [onlineResults, setOnlineResults] = useState<MusicSearchResult[]>([]);
  const [onlineError, setOnlineError] = useState("");
  const [notConfigured, setNotConfigured] = useState(false);

  const pendingRef = useRef({
    bgm: initial.bgm,
    voicePreset: initial.voicePreset,
    ttsLocale: initial.ttsLocale ?? ("en" as const),
  });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const applyingRef = useRef(false);
  const queuedRef = useRef(false);
  const wasRenderingRef = useRef(false);
  const userEditingRef = useRef(false);

  const isRendering =
    renderStatus === "preview_rendering" ||
    renderStatus === "final_rendering" ||
    saving ||
    awaitingRender ||
    applyingStart;

  const displayPercent = Math.min(100, Math.max(0, live.percent ?? (saving ? 2 : 0)));
  const phaseKey = live.phase && live.phase in PHASE_KEYS ? PHASE_KEYS[live.phase as RenderPhase] : null;

  const waveformMeta = useMemo(() => {
    if (bgm === "none") return null;
    if (bgm === "external") {
      const url = initial.externalBgm?.audioUrl;
      return url ? { url, durationSec: 180 } : null;
    }
    const track = getBgmTrackById(bgm);
    return track ? { url: track.fileUrl, durationSec: track.durationSec } : null;
  }, [bgm, initial.externalBgm]);

  useEffect(() => {
    if (userEditingRef.current || saving || applyingRef.current || awaitingRender || applyingStart) return;
    const s = readCreativeAudioSettings(editPlan ?? null);
    setBgm(s.bgm);
    setVoicePreset(s.voicePreset);
    setTtsLocale(s.ttsLocale ?? "en");
    setBgmStartOffset(s.bgmStartOffsetSec);
    setSavedBgmStartOffset(s.bgmStartOffsetSec);
    pendingRef.current = {
      bgm: s.bgm,
      voicePreset: s.voicePreset,
      ttsLocale: s.ttsLocale ?? "en",
    };
  }, [editPlan, saving, awaitingRender, applyingStart]);

  useEffect(() => {
    if (renderProgress) setLive(renderProgress);
  }, [renderProgress]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      audioRef.current?.pause();
    };
  }, []);

  useEffect(() => {
    if ((saving || awaitingRender) && previewPlaying) {
      audioRef.current?.pause();
      setPreviewPlaying(false);
    }
  }, [saving, awaitingRender, previewPlaying]);

  useEffect(() => {
    const rendering =
      renderStatus === "preview_rendering" || renderStatus === "final_rendering" || saving;

    if (rendering) wasRenderingRef.current = true;

    if (!rendering && !saving && !awaitingRender) return;

    async function poll() {
      try {
        const res = await fetch(`/api/creatives/${creativeId}`);
        const data = await res.json();
        const c = data.creative as
          | {
              renderProgress?: LiveProgress;
              renderStatus?: string;
              updatedAt?: string;
            }
          | undefined;
        if (c?.renderProgress) setLive(c.renderProgress);

        const stillRendering =
          c?.renderStatus === "preview_rendering" || c?.renderStatus === "final_rendering";
        if (stillRendering) wasRenderingRef.current = true;

        if (c?.renderProgress?.error) {
          setError(c.renderProgress.error);
          setAwaitingRender(false);
          userEditingRef.current = false;
          wasRenderingRef.current = false;
          return;
        }

        // Render truly finished only when worker flips status back to ready.
        if (!stillRendering && c?.renderStatus === "preview_ready" && wasRenderingRef.current) {
          wasRenderingRef.current = false;
          userEditingRef.current = false;
          setAwaitingRender(false);
          onRenderComplete?.();
        }
      } catch {
        // ignore poll errors
      }
    }

    void poll();
    const interval = setInterval(poll, 1500);
    return () => clearInterval(interval);
  }, [creativeId, renderStatus, saving, awaitingRender, onRenderComplete]);

  async function flushApply(bodyOverride?: Record<string, unknown>) {
    if (applyingRef.current) {
      if (!bodyOverride) queuedRef.current = true;
      return;
    }

    applyingRef.current = true;
    setSaving(true);
    setError("");
    setLive({ percent: 0, phase: "queued" });
    onRerenderStart?.();

    const patch = bodyOverride ?? { ...pendingRef.current };

    try {
      const res = await fetch(`/api/creatives/${creativeId}/audio`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? t("creative.audio.applyFailed"));
        userEditingRef.current = false;
        return;
      }
      wasRenderingRef.current = true;
      setAwaitingRender(true);
    } catch {
      setError(t("creative.audio.applyFailed"));
      userEditingRef.current = false;
    } finally {
      applyingRef.current = false;
      setSaving(false);
      if (queuedRef.current) {
        queuedRef.current = false;
        void flushApply();
      }
    }
  }

  function scheduleApply() {
    userEditingRef.current = true;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      void flushApply();
    }, APPLY_DEBOUNCE_MS);
  }

  function patchPending(partial: Partial<typeof pendingRef.current>) {
    pendingRef.current = { ...pendingRef.current, ...partial };
    scheduleApply();
  }

  function previewUrlFor(trackId: ClipBgmKey): string | undefined {
    if (trackId === "none") return undefined;
    return bgmOptions.find((o) => o.trackId === trackId)?.previewUrl;
  }

  // Audition any URL through the single shared <audio> element.
  function playUrl(url: string | undefined, key: string) {
    const el = audioRef.current;
    if (!el || !url) {
      setPreviewPlaying(false);
      setPreviewKey(null);
      return;
    }
    if (el.src !== url) el.src = url;
    el.currentTime = 0;
    el.play()
      .then(() => {
        setPreviewPlaying(true);
        setPreviewKey(key);
      })
      .catch(() => {
        setPreviewPlaying(false);
        setPreviewKey(null);
      });
  }

  function stopPreview() {
    const el = audioRef.current;
    if (el) el.pause();
    setPreviewPlaying(false);
    setPreviewKey(null);
  }

  function toggleBuiltinPreview() {
    if (previewPlaying && previewKey === `builtin:${bgm}`) {
      stopPreview();
    } else {
      playUrl(previewUrlFor(bgm), `builtin:${bgm}`);
    }
  }

  function toggleOnlinePreview(track: MusicSearchResult) {
    const key = `online:${track.trackId}`;
    if (previewPlaying && previewKey === key) {
      stopPreview();
    } else {
      playUrl(track.previewUrl, key);
    }
  }

  // Selecting in the dropdown only auditions the track; it does NOT re-render.
  function onBgmChange(next: ClipBgmKey) {
    userEditingRef.current = true;
    setBgm(next);
    if (next !== bgm) {
      setBgmStartOffset(0);
    }
    if (next === "none" || next === "external") {
      stopPreview();
    } else {
      playUrl(previewUrlFor(next), `builtin:${next}`);
    }
  }

  // Commit a built-in track — this is what triggers the (single) re-render.
  function applyBgm() {
    stopPreview();
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    pendingRef.current = { ...pendingRef.current, bgm };
    setBgmStartOffset(0);
    setSavedBgmStartOffset(0);
    void flushApply();
  }

  async function applyBgmStart() {
    userEditingRef.current = true;
    setApplyingStart(true);
    setError("");
    setLive({ percent: 0, phase: "queued" });
    onRerenderStart?.();
    try {
      const res = await fetch(`/api/creatives/${creativeId}/audio`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bgmStartOffsetSec: bgmStartOffset }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? t("creative.audio.applyFailed"));
        userEditingRef.current = false;
        return;
      }
      setSavedBgmStartOffset(bgmStartOffset);
      wasRenderingRef.current = true;
      setAwaitingRender(true);
    } catch {
      setError(t("creative.audio.applyFailed"));
      userEditingRef.current = false;
    } finally {
      setApplyingStart(false);
    }
  }

  async function runOnlineSearch() {
    setSearching(true);
    setOnlineError("");
    setNotConfigured(false);
    try {
      const res = await fetch(`/api/music/search?q=${encodeURIComponent(query)}&limit=24`);
      const data = await res.json();
      if (res.status === 501 || data.code === "NOT_CONFIGURED") {
        setNotConfigured(true);
        setOnlineResults([]);
        return;
      }
      if (!res.ok) {
        setOnlineError(data.error ?? t("creative.audio.onlineEmpty"));
        setOnlineResults([]);
        return;
      }
      setOnlineResults((data.results ?? []) as MusicSearchResult[]);
    } catch {
      setOnlineError(t("creative.audio.onlineEmpty"));
      setOnlineResults([]);
    } finally {
      setSearching(false);
    }
  }

  // Commit an online (Jamendo) track — triggers a single re-render.
  function applyExternalTrack(track: MusicSearchResult) {
    stopPreview();
    userEditingRef.current = true;
    setBgm("external" as ClipBgmKey);
    setBgmStartOffset(0);
    setSavedBgmStartOffset(0);
    void flushApply({
      external: {
        source: track.source,
        trackId: track.trackId,
        name: track.name,
        artist: track.artist,
        audioUrl: track.audioUrl,
        licenseUrl: track.licenseUrl,
        attribution: track.attribution,
      },
      voicePreset,
      ttsLocale,
    });
  }

  function onVoiceChange(next: ClipVoicePreset) {
    setVoicePreset(next);
    patchPending({ voicePreset: next });
  }

  function onLocaleChange(next: "en" | "zh") {
    setTtsLocale(next);
    patchPending({ ttsLocale: next });
  }

  const chipClass = (selected: boolean) =>
    `rounded-full border px-2.5 py-1 text-xs font-medium transition ${
      selected
        ? "border-navy bg-navy text-white"
        : "border-border bg-surface text-ink-secondary hover:border-brand-blue/40"
    } ${isRendering ? "pointer-events-none opacity-60" : ""}`;

  return (
    <div className={compact ? "space-y-2" : "space-y-3 rounded-lg border border-border bg-surface-muted/40 p-3"}>
      {!compact && (
        <p className="text-xs font-semibold text-navy">{t("creative.audio.title")}</p>
      )}

      <div>
        <label className="mb-1.5 block text-[10px] font-medium uppercase tracking-wide text-ink-secondary">
          {t("creative.music.changeMusic")}
        </label>
        <div className="flex items-center gap-1.5">
          <select
            disabled={isRendering}
            value={bgm}
            onChange={(e) => onBgmChange(e.target.value as ClipBgmKey)}
            className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-2.5 py-2 text-xs font-medium text-navy disabled:opacity-60"
          >
            <option value="none">{t("creative.audio.bgm.none")}</option>
            {initial.externalBgm && (
              <option value="external">{`🌐 ${initial.externalBgm.name}`}</option>
            )}
            {bgmOptions.map((track) => (
              <option key={track.trackId} value={track.trackId}>
                {track.trackName}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={isRendering || bgm === "none" || bgm === "external"}
            onClick={toggleBuiltinPreview}
            aria-label={
              previewPlaying && previewKey === `builtin:${bgm}`
                ? t("creative.audio.previewStop")
                : t("creative.audio.preview")
            }
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-navy transition hover:border-brand-blue/40 disabled:opacity-50"
          >
            {previewPlaying && previewKey === `builtin:${bgm}` ? (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
                <rect x="2" y="2" width="3" height="8" rx="1" />
                <rect x="7" y="2" width="3" height="8" rx="1" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
                <path d="M3 2.2v7.6c0 .4.45.65.8.43l6-3.8a.5.5 0 0 0 0-.86l-6-3.8A.5.5 0 0 0 3 2.2Z" />
              </svg>
            )}
          </button>
        </div>
        <audio
          ref={audioRef}
          preload="none"
          onEnded={() => {
            setPreviewPlaying(false);
            setPreviewKey(null);
          }}
          className="hidden"
        />
        <p className="mt-1 text-[10px] text-ink-secondary">
          {t("creative.audio.bgmSelect", { count: String(bgmOptions.length) })}
          {" · "}
          {t("creative.audio.previewHint")}
        </p>
        {bgm !== initial.bgm && bgm !== "external" && !isRendering && (
          <button
            type="button"
            onClick={applyBgm}
            className="mt-2 w-full rounded-lg bg-navy px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-navy/90"
          >
            {t("creative.audio.applyMusic")}
          </button>
        )}
        {initial.externalBgm && (
          <p className="mt-1 text-[10px] text-emerald-700">
            {t("creative.audio.onlineApplied", { name: initial.externalBgm.name })}
          </p>
        )}

        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowOnline((v) => !v)}
            className="text-[10px] font-medium text-brand-blue hover:underline"
          >
            {showOnline ? "▾ " : "▸ "}
            {t("creative.audio.onlineToggle")}
          </button>
        </div>

        {showOnline && (
          <div className="mt-2 space-y-2 rounded-lg border border-border bg-surface p-2">
            <p className="text-[10px] font-medium uppercase tracking-wide text-ink-secondary">
              {t("creative.audio.onlineTitle")}
            </p>
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={query}
                disabled={isRendering || searching}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void runOnlineSearch();
                }}
                placeholder={t("creative.audio.onlineSearchPlaceholder")}
                className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-navy disabled:opacity-60"
              />
              <button
                type="button"
                disabled={isRendering || searching}
                onClick={() => void runOnlineSearch()}
                className="shrink-0 rounded-lg bg-brand-blue px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-blue/90 disabled:opacity-50"
              >
                {searching ? t("creative.audio.onlineSearching") : t("creative.audio.onlineSearch")}
              </button>
            </div>

            {notConfigured && (
              <p className="text-[10px] text-amber-600">{t("creative.audio.onlineNotConfigured")}</p>
            )}
            {onlineError && <p className="text-[10px] text-red-600">{onlineError}</p>}
            {!notConfigured && !onlineError && onlineResults.length === 0 && !searching && (
              <p className="text-[10px] text-ink-secondary">{t("creative.audio.onlineEmpty")}</p>
            )}

            {onlineResults.length > 0 && (
              <ul className="max-h-56 space-y-1 overflow-y-auto">
                {onlineResults.map((track) => {
                  const playing = previewPlaying && previewKey === `online:${track.trackId}`;
                  return (
                    <li
                      key={track.trackId}
                      className="flex items-center gap-2 rounded-md border border-border/60 bg-surface-muted/30 px-2 py-1.5"
                    >
                      <button
                        type="button"
                        onClick={() => toggleOnlinePreview(track)}
                        aria-label={playing ? t("creative.audio.previewStop") : t("creative.audio.preview")}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-navy transition hover:border-brand-blue/40"
                      >
                        {playing ? (
                          <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
                            <rect x="2" y="2" width="3" height="8" rx="1" />
                            <rect x="7" y="2" width="3" height="8" rx="1" />
                          </svg>
                        ) : (
                          <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
                            <path d="M3 2.2v7.6c0 .4.45.65.8.43l6-3.8a.5.5 0 0 0 0-.86l-6-3.8A.5.5 0 0 0 3 2.2Z" />
                          </svg>
                        )}
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-navy">{track.name}</p>
                        <p className="truncate text-[10px] text-ink-secondary">{track.artist}</p>
                      </div>
                      <button
                        type="button"
                        disabled={isRendering}
                        onClick={() => applyExternalTrack(track)}
                        className="shrink-0 rounded-md bg-navy px-2.5 py-1 text-[10px] font-semibold text-white transition hover:bg-navy/90 disabled:opacity-50"
                      >
                        {t("creative.audio.onlineUse")}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="text-[10px] text-ink-secondary">{t("creative.audio.onlineAttributionHint")}</p>
          </div>
        )}
      </div>

      {waveformMeta && bgm !== "none" && (
        <BgmStartWaveform
          audioUrl={waveformMeta.url}
          trackDurationSec={waveformMeta.durationSec}
          clipDurationSec={initial.clipDurationSec}
          offsetSec={bgmStartOffset}
          savedOffsetSec={savedBgmStartOffset}
          disabled={isRendering || applyingStart}
          onOffsetChange={setBgmStartOffset}
          onApply={() => void applyBgmStart()}
          applying={applyingStart || saving}
        />
      )}

      <div>
        <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-ink-secondary">
          {t("creative.audio.ttsLabel")}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {(["female", "male", "none"] as const).map((preset) => (
            <button
              key={preset}
              type="button"
              disabled={isRendering}
              onClick={() => onVoiceChange(preset)}
              className={chipClass(voicePreset === preset)}
            >
              {t(`campaign.voice.${preset}` as TranslationKey)}
            </button>
          ))}
        </div>
        {voicePreset !== "none" && (
          <p className="mt-1.5 text-[10px] text-ink-secondary">{t("creative.audio.voiceApplyHint")}</p>
        )}
      </div>

      {initial.hasBilingualScripts && voicePreset !== "none" && (
        <div>
          <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-ink-secondary">
            {t("creative.audio.ttsLangLabel")}
          </p>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              disabled={isRendering}
              onClick={() => onLocaleChange("en")}
              className={chipClass(ttsLocale === "en")}
            >
              EN
            </button>
            <button
              type="button"
              disabled={isRendering}
              onClick={() => onLocaleChange("zh")}
              className={chipClass(ttsLocale === "zh")}
            >
              中文
            </button>
          </div>
        </div>
      )}

      {isRendering && (
        <div className="space-y-1.5 rounded-lg bg-surface px-2.5 py-2">
          <div className="flex items-center justify-between gap-2 text-[10px]">
            <span className="font-medium text-brand-blue">
              {t("creative.audio.updatingProgress", { percent: String(displayPercent) })}
            </span>
            {phaseKey && (
              <span className="text-ink-secondary">{t(phaseKey)}</span>
            )}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-border">
            <div
              className="h-full rounded-full bg-brand-blue transition-all duration-500 ease-out"
              style={{ width: `${Math.max(displayPercent, saving ? 4 : 0)}%` }}
            />
          </div>
        </div>
      )}
      {error && <p className="text-[10px] text-red-600">{error}</p>}
      {isRendering && displayPercent === 0 && live.phase === "queued" && (
        <p className="text-[10px] text-ink-secondary">{t("creative.audio.workerHint")}</p>
      )}
    </div>
  );
}
