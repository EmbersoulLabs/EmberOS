"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { resolveBgmStartOffsetSec } from "@ceo-agent/shared";
import { useI18n } from "@/lib/i18n/provider";

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function computePeaks(channel: Float32Array, buckets: number): number[] {
  const block = Math.max(1, Math.floor(channel.length / buckets));
  const peaks: number[] = [];
  for (let i = 0; i < buckets; i++) {
    let sum = 0;
    const start = i * block;
    for (let j = 0; j < block; j++) {
      sum += Math.abs(channel[start + j] ?? 0);
    }
    peaks.push(sum / block);
  }
  const max = Math.max(...peaks, 0.0001);
  return peaks.map((p) => p / max);
}

export function BgmStartWaveform({
  audioUrl,
  trackDurationSec,
  clipDurationSec,
  offsetSec,
  savedOffsetSec,
  disabled,
  onOffsetChange,
  onApply,
  applying,
}: {
  audioUrl: string;
  trackDurationSec: number;
  clipDurationSec: number;
  offsetSec: number;
  savedOffsetSec: number;
  disabled?: boolean;
  onOffsetChange: (sec: number) => void;
  onApply: () => void;
  applying?: boolean;
}) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [duration, setDuration] = useState(trackDurationSec);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [loadingWave, setLoadingWave] = useState(false);
  const [playing, setPlaying] = useState(false);
  const dragRef = useRef(false);

  const tailNeeded = Math.max(8, clipDurationSec + 3);
  const maxStart = Math.max(0, duration - tailNeeded);
  const clampedOffset = Math.min(maxStart, Math.max(0, offsetSec));
  const dirty = Math.abs(clampedOffset - savedOffsetSec) > 0.05;

  useEffect(() => {
    setDuration(trackDurationSec);
  }, [trackDurationSec]);

  useEffect(() => {
    if (!audioUrl) return;
    let cancelled = false;
    setLoadingWave(true);
    setPeaks([]);

    async function loadWaveform() {
      try {
        const res = await fetch(audioUrl);
        if (!res.ok) throw new Error("fetch failed");
        const arrayBuffer = await res.arrayBuffer();
        const ctx = new AudioContext();
        const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
        if (cancelled) {
          await ctx.close();
          return;
        }
        setDuration(decoded.duration);
        setPeaks(computePeaks(decoded.getChannelData(0), 140));
        await ctx.close();
      } catch {
        if (!cancelled) {
          setDuration(trackDurationSec);
          setPeaks([]);
        }
      } finally {
        if (!cancelled) setLoadingWave(false);
      }
    }

    void loadWaveform();
    return () => {
      cancelled = true;
    };
  }, [audioUrl, trackDurationSec]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    const width = container.clientWidth;
    const height = 56;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    if (peaks.length > 0) {
      const barW = width / peaks.length;
      peaks.forEach((p, i) => {
        const barH = p * height * 0.82;
        ctx.fillStyle = "#cbd5e1";
        ctx.fillRect(i * barW, (height - barH) / 2, Math.max(1, barW - 0.5), barH);
      });
    } else {
      ctx.fillStyle = "#e2e8f0";
      ctx.fillRect(0, height / 2 - 1, width, 2);
    }

    const startX = duration > 0 ? (clampedOffset / duration) * width : 0;
    ctx.fillStyle = "rgba(30, 58, 95, 0.1)";
    ctx.fillRect(startX, 0, width - startX, height);
    ctx.strokeStyle = "#1e3a5f";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(startX, 0);
    ctx.lineTo(startX, height);
    ctx.stroke();
    ctx.fillStyle = "#1e3a5f";
    ctx.beginPath();
    ctx.arc(startX, height / 2, 5, 0, Math.PI * 2);
    ctx.fill();
  }, [peaks, clampedOffset, duration]);

  const pointerToOffset = useCallback(
    (clientX: number) => {
      const el = containerRef.current;
      if (!el || duration <= 0) return 0;
      const rect = el.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return Math.min(maxStart, Math.round(ratio * duration * 10) / 10);
    },
    [duration, maxStart]
  );

  function onPointerDown(e: React.PointerEvent) {
    if (disabled) return;
    dragRef.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    onOffsetChange(pointerToOffset(e.clientX));
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragRef.current || disabled) return;
    onOffsetChange(pointerToOffset(e.clientX));
  }

  function onPointerUp() {
    dragRef.current = false;
  }

  function togglePreview() {
    const el = audioRef.current;
    if (!el || disabled) return;
    if (playing) {
      el.pause();
      setPlaying(false);
      return;
    }
    if (el.src !== audioUrl) el.src = audioUrl;
    el.currentTime = clampedOffset;
    el.play()
      .then(() => setPlaying(true))
      .catch(() => setPlaying(false));
  }

  function setPreset(mode: "start" | "middle" | "auto") {
    const next = resolveBgmStartOffsetSec(duration, clipDurationSec, mode);
    onOffsetChange(next);
  }

  const chipClass = (selected: boolean) =>
    `rounded-full border px-2.5 py-1 text-xs font-medium transition ${
      selected
        ? "border-navy bg-navy text-white"
        : "border-border bg-surface text-ink-secondary hover:border-brand-blue/40"
    } ${disabled ? "pointer-events-none opacity-60" : ""}`;

  const atStart = clampedOffset < 0.5;
  const middleTarget = resolveBgmStartOffsetSec(duration, clipDurationSec, "middle");
  const atMiddle = Math.abs(clampedOffset - middleTarget) < 1;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-medium uppercase tracking-wide text-ink-secondary">
          {t("creative.audio.bgmStart.title")}
        </p>
        <span className="text-[10px] tabular-nums text-ink-secondary">
          {formatTime(clampedOffset)} / {formatTime(duration)}
        </span>
      </div>
      <p className="text-[10px] text-ink-secondary">{t("creative.audio.bgmStart.hint")}</p>

      <div
        ref={containerRef}
        role="slider"
        aria-valuemin={0}
        aria-valuemax={maxStart}
        aria-valuenow={clampedOffset}
        aria-label={t("creative.audio.bgmStart.title")}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className={`relative cursor-col-resize overflow-hidden rounded-lg border border-border bg-surface ${
          disabled ? "pointer-events-none opacity-60" : ""
        }`}
      >
        <canvas ref={canvasRef} className="block w-full touch-none" />
        {loadingWave && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface/70 text-[10px] text-ink-secondary">
            {t("creative.audio.bgmStart.loading")}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" disabled={disabled} onClick={() => setPreset("start")} className={chipClass(atStart)}>
          {t("creative.audio.bgmStart.fromStart")}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setPreset("middle")}
          className={chipClass(atMiddle && !atStart)}
        >
          {t("creative.audio.bgmStart.fromMiddle")}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={togglePreview}
          className="ml-auto flex h-8 items-center gap-1 rounded-lg border border-border bg-surface px-2.5 text-[10px] font-medium text-navy transition hover:border-brand-blue/40 disabled:opacity-50"
        >
          {playing ? t("creative.audio.previewStop") : t("creative.audio.bgmStart.previewFromHere")}
        </button>
      </div>

      {dirty && !disabled && (
        <button
          type="button"
          disabled={applying}
          onClick={onApply}
          className="w-full rounded-lg bg-navy px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-navy/90 disabled:opacity-60"
        >
          {applying ? t("creative.audio.bgmStart.applying") : t("creative.audio.bgmStart.apply")}
        </button>
      )}

      <audio
        ref={audioRef}
        preload="none"
        onEnded={() => setPlaying(false)}
        className="hidden"
      />
    </div>
  );
}
