/** Smart BGM mix filters — fade, duck under voice/dialogue, normalize. */

export interface SmartBgmMixOptions {
  durationSec: number;
  bgmBaseVol?: number;
  fadeInSec?: number;
  fadeOutSec?: number;
  duckUnderVoice?: boolean;
  voiceLabel?: string;
  bgmLabel?: string;
  bgmStartOffsetSec?: number;
}

const DEFAULT_BGM_VOL = 0.28;
const FADE_IN = 0.6;
const FADE_OUT = 0.8;

export function bgmBedFilter(
  inputLabel: string,
  outputLabel: string,
  durationSec: number,
  baseVol = DEFAULT_BGM_VOL,
  fadeInSec = FADE_IN,
  fadeOutSec = FADE_OUT,
  startOffsetSec = 0
): string {
  const start = Math.max(0, startOffsetSec);
  const dur = Math.max(3, durationSec);
  const fadeOutStart = Math.max(0, dur - fadeOutSec);
  const trimEnd = start + dur + 4;
  return `[${inputLabel}]atrim=${start.toFixed(2)}:${trimEnd.toFixed(2)},asetpts=PTS-STARTPTS,volume=${baseVol},afade=t=in:st=0:d=${fadeInSec},afade=t=out:st=${fadeOutStart.toFixed(2)}:d=${fadeOutSec}[${outputLabel}]`;
}

export function duckBgmUnderVoice(
  bgmLabel: string,
  voiceLabel: string,
  outputLabel: string,
  ratio = 6
): string {
  return `[${bgmLabel}][${voiceLabel}]sidechaincompress=threshold=0.02:ratio=${ratio}:attack=30:release=600:makeup=1[${outputLabel}]`;
}

export function mixVoiceWithSmartBgm(
  voiceLabel: string,
  bgmInputLabel: string,
  outputLabel: string,
  opts: SmartBgmMixOptions
): string {
  const {
    durationSec,
    bgmBaseVol = DEFAULT_BGM_VOL,
    fadeInSec = FADE_IN,
    fadeOutSec = FADE_OUT,
    duckUnderVoice = true,
    bgmStartOffsetSec = 0,
  } = opts;

  const bgmBed = "bgmBed";
  const bgmDucked = "bgmDuck";
  const parts = [
    bgmBedFilter(bgmInputLabel, bgmBed, durationSec, bgmBaseVol, fadeInSec, fadeOutSec, bgmStartOffsetSec),
  ];

  if (duckUnderVoice) {
    parts.push(duckBgmUnderVoice(bgmBed, voiceLabel, bgmDucked));
    parts.push(
      `[${voiceLabel}][${bgmDucked}]amix=inputs=2:duration=first:dropout_transition=2:normalize=0[preNorm]`
    );
  } else {
    parts.push(
      `[${voiceLabel}][${bgmBed}]amix=inputs=2:duration=first:dropout_transition=2:normalize=0[preNorm]`
    );
  }

  parts.push(`[preNorm]loudnorm=I=-14:TP=-1.5:LRA=11[${outputLabel}]`);
  return parts.join(";");
}

export function mixDialogueWithSmartBgm(
  dialogueLabel: string,
  bgmInputLabel: string,
  outputLabel: string,
  durationSec: number,
  dialogueVol = 0.35,
  bgmBaseVol = DEFAULT_BGM_VOL,
  bgmStartOffsetSec = 0
): string {
  const dur = Math.max(3, durationSec);
  const fadeOutStart = Math.max(0, dur - FADE_OUT);
  const start = Math.max(0, bgmStartOffsetSec);
  const trimEnd = start + dur + 4;
  return [
    `[${dialogueLabel}]volume=${dialogueVol}[dlg]`,
    `[${bgmInputLabel}]atrim=${start.toFixed(2)}:${trimEnd.toFixed(2)},asetpts=PTS-STARTPTS,volume=${bgmBaseVol},afade=t=in:st=0:d=${FADE_IN},afade=t=out:st=${fadeOutStart.toFixed(2)}:d=${FADE_OUT}[bgm]`,
    `[bgm][dlg]sidechaincompress=threshold=0.03:ratio=5:attack=30:release=600:makeup=1[bgmduck]`,
    `[dlg][bgmduck]amix=inputs=2:duration=first:dropout_transition=2:normalize=0[preNorm]`,
    `[preNorm]loudnorm=I=-14:TP=-1.5:LRA=11[${outputLabel}]`,
  ].join(";");
}
