import {
  computeProductPlacementPixels,
  PhotoSceneMarketingError,
  type OfficialSceneShadowPreset,
  type PhotoSceneMarketingInputCapsuleV1,
  type PhotoSceneOverlayCopyV1,
  type PhotoScenePlacementV1,
  type PhotoSceneSafeAreaV1,
} from "@ceo-agent/shared";
import { decodeRgbaPng, encodeRgbaPng } from "./png";

export type DecodedRgbaImage = {
  width: number;
  height: number;
  rgba: Buffer;
};

const FONT_5X7: Record<string, number[]> = {
  " ": [0, 0, 0, 0, 0],
  A: [14, 17, 31, 17, 17],
  B: [30, 17, 30, 17, 30],
  C: [14, 17, 16, 17, 14],
  D: [30, 17, 17, 17, 30],
  E: [31, 16, 30, 16, 31],
  F: [31, 16, 30, 16, 16],
  G: [14, 16, 19, 17, 14],
  H: [17, 17, 31, 17, 17],
  I: [14, 4, 4, 4, 14],
  J: [1, 1, 1, 17, 14],
  K: [17, 18, 28, 18, 17],
  L: [16, 16, 16, 16, 31],
  M: [17, 27, 21, 17, 17],
  N: [17, 25, 21, 19, 17],
  O: [14, 17, 17, 17, 14],
  P: [30, 17, 30, 16, 16],
  Q: [14, 17, 17, 19, 15],
  R: [30, 17, 30, 18, 17],
  S: [15, 16, 14, 1, 30],
  T: [31, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 14],
  V: [17, 17, 17, 10, 4],
  W: [17, 17, 21, 21, 10],
  X: [17, 10, 4, 10, 17],
  Y: [17, 10, 4, 4, 4],
  Z: [31, 2, 4, 8, 31],
  "0": [14, 19, 21, 25, 14],
  "1": [4, 12, 4, 4, 14],
  "2": [14, 1, 6, 8, 31],
  "3": [30, 1, 14, 1, 30],
  "4": [2, 6, 10, 31, 2],
  "5": [31, 16, 30, 1, 30],
  "6": [14, 16, 30, 17, 14],
  "7": [31, 1, 2, 4, 8],
  "8": [14, 17, 14, 17, 14],
  "9": [14, 17, 15, 1, 14],
  ".": [0, 0, 0, 0, 4],
  "!": [4, 4, 4, 0, 4],
  "?": [14, 1, 6, 0, 4],
  "-": [0, 0, 14, 0, 0],
  "'": [4, 4, 0, 0, 0],
};

function sampleNearest(src: DecodedRgbaImage, x: number, y: number): [number, number, number, number] {
  const sx = Math.max(0, Math.min(src.width - 1, Math.round(x)));
  const sy = Math.max(0, Math.min(src.height - 1, Math.round(y)));
  const i = (sy * src.width + sx) * 4;
  return [src.rgba[i]!, src.rgba[i + 1]!, src.rgba[i + 2]!, src.rgba[i + 3]!];
}

function resizeCover(src: DecodedRgbaImage, width: number, height: number): DecodedRgbaImage {
  const scale = Math.max(width / src.width, height / src.height);
  const scaledW = src.width * scale;
  const scaledH = src.height * scale;
  const ox = (scaledW - width) / 2;
  const oy = (scaledH - height) / 2;
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = sampleNearest(src, (x + ox) / scale, (y + oy) / scale);
      const i = (y * width + x) * 4;
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = a;
    }
  }
  return { width, height, rgba };
}

function resizeExact(src: DecodedRgbaImage, width: number, height: number): DecodedRgbaImage {
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = sampleNearest(
        src,
        (x + 0.5) * (src.width / width) - 0.5,
        (y + 0.5) * (src.height / height) - 0.5
      );
      const i = (y * width + x) * 4;
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = a;
    }
  }
  return { width, height, rgba };
}

function blend(dst: Buffer, width: number, x: number, y: number, r: number, g: number, b: number, a: number) {
  if (a <= 0 || x < 0 || y < 0 || x >= width) return;
  const i = (y * width + x) * 4;
  if (i < 0 || i + 3 >= dst.length) return;
  const da = dst[i + 3]! / 255;
  const sa = a / 255;
  const outA = sa + da * (1 - sa);
  if (outA <= 0) return;
  dst[i] = Math.round((r * sa + dst[i]! * da * (1 - sa)) / outA);
  dst[i + 1] = Math.round((g * sa + dst[i + 1]! * da * (1 - sa)) / outA);
  dst[i + 2] = Math.round((b * sa + dst[i + 2]! * da * (1 - sa)) / outA);
  dst[i + 3] = Math.round(outA * 255);
}

function blit(
  dst: Buffer,
  canvasWidth: number,
  src: DecodedRgbaImage,
  ox: number,
  oy: number,
  alphaScale = 1
) {
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const i = (y * src.width + x) * 4;
      const a = Math.round(src.rgba[i + 3]! * alphaScale);
      blend(dst, canvasWidth, ox + x, oy + y, src.rgba[i]!, src.rgba[i + 1]!, src.rgba[i + 2]!, a);
    }
  }
}

function applyShadow(
  canvas: Buffer,
  canvasWidth: number,
  product: DecodedRgbaImage,
  ox: number,
  oy: number,
  preset: OfficialSceneShadowPreset
) {
  if (preset === "none") return;
  if (preset === "soft") {
    const offsetX = Math.max(2, Math.round(product.width * 0.04));
    const offsetY = Math.max(3, Math.round(product.height * 0.06));
    for (let y = 0; y < product.height; y++) {
      for (let x = 0; x < product.width; x++) {
        const a = product.rgba[(y * product.width + x) * 4 + 3]!;
        if (a < 8) continue;
        blend(canvas, canvasWidth, ox + x + offsetX, oy + y + offsetY, 16, 16, 16, Math.round(a * 0.35));
      }
    }
    return;
  }
  const cx = ox + Math.round(product.width / 2);
  const cy = oy + product.height - Math.max(2, Math.round(product.height * 0.04));
  const rx = Math.max(4, Math.round(product.width * 0.38));
  const ry = Math.max(2, Math.round(product.height * 0.08));
  for (let y = cy - ry; y <= cy + ry; y++) {
    for (let x = cx - rx; x <= cx + rx; x++) {
      const nx = (x - cx) / rx;
      const ny = (y - cy) / ry;
      const d = nx * nx + ny * ny;
      if (d > 1) continue;
      blend(canvas, canvasWidth, x, y, 20, 20, 20, Math.round((1 - d) * 90));
    }
  }
}

function parseHexColor(value: string | undefined): [number, number, number] {
  const hex = (value?.trim() ?? "").replace(/^#/, "");
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
  }
  return [255, 255, 255];
}

function drawGlyph(
  canvas: Buffer,
  canvasWidth: number,
  canvasHeight: number,
  ch: string,
  x: number,
  y: number,
  scale: number,
  color: [number, number, number]
) {
  const glyph = FONT_5X7[ch] ?? FONT_5X7["?"]!;
  for (let col = 0; col < 5; col++) {
    const bits = glyph[col]!;
    for (let row = 0; row < 7; row++) {
      if (((bits >> (6 - row)) & 1) === 0) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const px = x + col * scale + dx;
          const py = y + row * scale + dy;
          if (py < 0 || py >= canvasHeight) continue;
          blend(canvas, canvasWidth, px, py, 16, 16, 16, 180);
          blend(canvas, canvasWidth, px, py - 1, color[0], color[1], color[2], 255);
        }
      }
    }
  }
}

function drawCenteredText(
  canvas: Buffer,
  canvasWidth: number,
  canvasHeight: number,
  text: string,
  y: number,
  scale: number,
  color: [number, number, number]
) {
  const chars = text.toUpperCase().split("");
  const glyphW = 6 * scale;
  let x = Math.round((canvasWidth - chars.length * glyphW) / 2);
  for (const ch of chars) {
    const glyph = FONT_5X7[ch] ? ch : ch === " " ? " " : "?";
    drawGlyph(canvas, canvasWidth, canvasHeight, glyph, x, y, scale, color);
    x += glyphW;
  }
}

function drawOverlay(
  canvas: Buffer,
  width: number,
  height: number,
  overlay: PhotoSceneOverlayCopyV1,
  brandColor: string | undefined
) {
  const color = parseHexColor(brandColor);
  const scale = width >= 1080 ? 4 : 2;
  if (overlay.headline) {
    drawCenteredText(canvas, width, height, overlay.headline.slice(0, 24), Math.round(height * 0.06), scale, color);
  }
  if (overlay.label) {
    drawCenteredText(
      canvas,
      width,
      height,
      overlay.label.slice(0, 18),
      Math.round(height * 0.12),
      Math.max(2, scale - 1),
      color
    );
  }
  if (overlay.cta) {
    drawCenteredText(canvas, width, height, overlay.cta.slice(0, 18), height - Math.round(height * 0.1), scale, color);
  }
}

export function productPlacementRect(input: {
  canvasWidth: number;
  canvasHeight: number;
  safeArea: PhotoSceneSafeAreaV1;
  placement: PhotoScenePlacementV1;
  productWidth: number;
  productHeight: number;
}) {
  return computeProductPlacementPixels(input);
}

/**
 * Deterministic V1 compositor.
 * Geometry is identical for the same frozen inputs.
 * This encoder produces identical PNG bytes for the same RGBA on a given Node zlib.
 * Cross-environment zlib is not claimed byte-identical; composition geometry remains deterministic.
 */
export function composeMarketingImageFromLayers(input: {
  width: number;
  height: number;
  scene: DecodedRgbaImage;
  product: DecodedRgbaImage;
  safeArea: PhotoSceneSafeAreaV1;
  placement: PhotoScenePlacementV1;
  shadowPreset: OfficialSceneShadowPreset;
  overlayCopy: PhotoSceneOverlayCopyV1;
  brandColor?: string;
  logo?: DecodedRgbaImage | null;
}): Buffer {
  const canvas = resizeCover(input.scene, input.width, input.height);
  const rect = computeProductPlacementPixels({
    canvasWidth: input.width,
    canvasHeight: input.height,
    safeArea: input.safeArea,
    placement: input.placement,
    productWidth: input.product.width,
    productHeight: input.product.height,
  });
  const product = resizeExact(input.product, rect.width, rect.height);
  applyShadow(canvas.rgba, input.width, product, rect.x, rect.y, input.shadowPreset);
  blit(canvas.rgba, input.width, product, rect.x, rect.y);
  if (input.logo && input.logo.width > 0) {
    const logoW = Math.max(24, Math.round(input.width * 0.12));
    const logoH = Math.max(24, Math.round((logoW * input.logo.height) / Math.max(1, input.logo.width)));
    blit(
      canvas.rgba,
      input.width,
      resizeExact(input.logo, logoW, logoH),
      Math.round(input.width * 0.05),
      Math.round(input.height * 0.04)
    );
  }
  drawOverlay(canvas.rgba, input.width, input.height, input.overlayCopy, input.brandColor);
  return encodeRgbaPng(input.width, input.height, canvas.rgba);
}

export function composeFrozenMarketingImage(input: {
  capsule: PhotoSceneMarketingInputCapsuleV1;
  sceneBytes: Buffer;
  productBytes: Buffer;
  logoBytes?: Buffer | null;
}): Buffer {
  try {
    return composeMarketingImageFromLayers({
      width: input.capsule.width,
      height: input.capsule.height,
      scene: decodeRgbaPng(input.sceneBytes),
      product: decodeRgbaPng(input.productBytes),
      safeArea: input.capsule.sceneSafeArea,
      placement: input.capsule.scene.placement,
      shadowPreset: input.capsule.scene.placement.shadowPreset,
      overlayCopy: input.capsule.overlayCopy,
      brandColor: input.capsule.brandSnapshot.brandColors[0],
      logo: input.logoBytes?.length ? decodeRgbaPng(input.logoBytes) : null,
    });
  } catch (err) {
    if (err instanceof PhotoSceneMarketingError) throw err;
    throw new PhotoSceneMarketingError(
      "COMPOSITION_FAILED",
      err instanceof Error ? err.message : "Deterministic composition failed"
    );
  }
}
