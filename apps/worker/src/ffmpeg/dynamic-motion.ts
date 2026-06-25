import type { ClipMotion } from "@ceo-agent/shared";
import { DYNAMIC_CAMERA } from "@ceo-agent/shared";
import { build916FitChain, FFMPEG_CROP_916_CENTER, FFMPEG_SCALE_FOR_916 } from "./filters-916";

export interface MotionFocus {
  x: number;
  y: number;
}

function clampFocus(v: number): number {
  return Math.max(0.08, Math.min(0.92, v));
}

/** zoompan x/y expressions that keep the subject near frame center. */
function focusExprs(focus: MotionFocus): { x: string; y: string } {
  const fx = clampFocus(focus.x);
  const fy = clampFocus(focus.y);
  const x = `max(0\\,min(iw-iw/zoom\\,iw*${fx}-iw/zoom/2))`;
  const y = `max(0\\,min(ih-ih/zoom\\,ih*${fy}-ih/zoom/2))`;
  return { x, y };
}

function panXExpr(
  motion: ClipMotion,
  frames: number,
  focus: MotionFocus,
  zoom: number
): string {
  const fx = clampFocus(focus.x);
  const travel = 0.22;
  if (motion === "pan_right") {
    return `max(0\\,min(iw-iw/zoom\\,(iw-iw/zoom)*(${fx - travel / 2}+${travel}*on/${frames})))`;
  }
  if (motion === "pan_left") {
    return `max(0\\,min(iw-iw/zoom\\,(iw-iw/zoom)*(${fx + travel / 2}-${travel}*on/${frames})))`;
  }
  return focusExprs(focus).x;
}

/**
 * Ken Burns + pan filter chain for one virtual beat.
 * Zoom range: 100% → 115% on zoom-in beats; reverse on zoom-out.
 */
export function buildDynamicMotionFilter(
  scale: string,
  durationSec: number,
  motion: ClipMotion = "slow_zoom_in",
  focus: MotionFocus = { x: 0.5, y: 0.5 },
  renderMode: "preview" | "final" | "subtitles_only" = "preview"
): string {
  const [w, h] = scale.split(":").map(Number);
  const frames = Math.max(24, Math.ceil(durationSec * 30));
  const fit916 = `${FFMPEG_SCALE_FOR_916},${FFMPEG_CROP_916_CENTER}`;
  const zMax = renderMode === "final" ? DYNAMIC_CAMERA.ZOOM_MAX : 1.12;
  const zMin = DYNAMIC_CAMERA.ZOOM_MIN;
  const zoomRange = zMax - zMin;
  const zoomStep = zoomRange / frames;
  const { y } = focusExprs(focus);

  let zoomExpr: string;
  let xExpr: string;

  switch (motion) {
    case "slow_zoom_out": {
      zoomExpr = `if(eq(on\\,1)\\,${zMax}\\,max(${zMin}\\,pzoom-${zoomStep}))`;
      xExpr = focusExprs(focus).x;
      break;
    }
    case "pan_left":
    case "pan_right": {
      const panZoom = 1.08;
      zoomExpr = String(panZoom);
      xExpr = panXExpr(motion, frames, focus, panZoom);
      break;
    }
    case "pan_up": {
      const panZoom = 1.08;
      zoomExpr = String(panZoom);
      const fy = clampFocus(focus.y);
      xExpr = focusExprs(focus).x;
      const travel = 0.18;
      const yPan = `max(0\\,min(ih-ih/zoom\\,(ih-ih/zoom)*(${fy + travel / 2}-${travel}*on/${frames})))`;
      return `${fit916},scale=${scale},zoompan=z='${zoomExpr}':x='${xExpr}':y='${yPan}':d=${frames}:s=${w}x${h}:fps=30`;
    }
    case "focus_pull":
    case "slow_zoom_in":
    default: {
      zoomExpr = `min(pzoom+${zoomStep}\\,${zMax})`;
      xExpr = focusExprs(focus).x;
      break;
    }
  }

  return `${fit916},scale=${scale},zoompan=z='${zoomExpr}':x='${xExpr}':y='${y}':d=${frames}:s=${w}x${h}:fps=30`;
}

/**
 * Real video playback filters — do NOT use zoompan here (it freezes the first frame).
 * Virtual cuts + source time ranges provide motion; this only fits 9:16 and sets fps.
 */
export function buildVideoClipFilter(
  scale: string,
  speed: number,
  effects?: Array<{ type: string; startSec?: number; durationSec?: number }>
): string {
  let chain = build916FitChain(scale);
  const fadeIn = effects?.find((e) => e.type === "fade_in");
  const fadeOut = effects?.find((e) => e.type === "fade_out");
  if (fadeIn) {
    chain += `,fade=t=in:st=0:d=${(fadeIn.durationSec ?? 0.15).toFixed(3)}`;
  }
  if (fadeOut && fadeOut.startSec != null && fadeOut.durationSec != null) {
    chain += `,fade=t=out:st=${fadeOut.startSec.toFixed(3)}:d=${fadeOut.durationSec.toFixed(3)}`;
  }
  if (speed !== 1) {
    chain += `,setpts=PTS/${speed}`;
  }
  chain += ",fps=30";
  return chain;
}

/** Edge fades at virtual beat boundaries (crossfade handles blend between beats). */
export function segmentTransitionFilters(isFirst: boolean, isLast: boolean, durationSec: number): string {
  const fade = DYNAMIC_CAMERA.CROSSFADE_SEC;
  const parts: string[] = [];
  if (!isFirst) {
    parts.push(`fade=t=in:st=0:d=${fade}`);
  }
  if (!isLast) {
    const outStart = Math.max(0, durationSec - fade);
    parts.push(`fade=t=out:st=${outStart.toFixed(3)}:d=${fade}`);
  }
  return parts.join(",");
}
