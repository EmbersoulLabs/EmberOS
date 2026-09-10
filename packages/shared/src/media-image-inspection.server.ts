import { inflateSync } from "node:zlib";
import { PRODUCT_TRANSPARENCY_INSPECTION_POLICY } from "./ai-story-product-background-suitability";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export type ProductImageByteInspection = {
  status: "INSPECTED" | "UNSUPPORTED" | "FAILED";
  byteLength: number;
  width?: number;
  height?: number;
  transparencyState:
    | "CERTIFIED_TRANSPARENT_BACKGROUND"
    | "FULLY_OPAQUE"
    | "INSUFFICIENT_TRANSPARENCY"
    | "UNINSPECTABLE";
  transparentPixelRatio?: number;
  boundaryTransparentPixelRatio?: number;
  reason?: string;
};

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let value = n;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[n] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Buffer): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value = CRC_TABLE[(value ^ byte) & 0xff]! ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function roundedRatio(numerator: number, denominator: number): number {
  return Math.round((numerator / denominator) * 1_000_000) / 1_000_000;
}

function paeth(left: number, up: number, upperLeft: number): number {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  return upDistance <= upperLeftDistance ? up : upperLeft;
}

function inspectPng(bytes: Buffer): ProductImageByteInspection {
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let sawHeader = false;
  let sawEnd = false;
  let hasTransparencyChunk = false;
  const compressed: Buffer[] = [];
  let offset = PNG_SIGNATURE.length;

  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > bytes.length) throw new Error("PNG chunk exceeds source bounds");
    const typeBytes = bytes.subarray(offset + 4, offset + 8);
    const type = typeBytes.toString("ascii");
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    const expectedCrc = bytes.readUInt32BE(offset + 8 + length);
    if (crc32(Buffer.concat([typeBytes, data])) !== expectedCrc) {
      throw new Error("PNG chunk checksum is invalid");
    }
    if (type === "IHDR") {
      if (sawHeader || length !== 13 || offset !== PNG_SIGNATURE.length) {
        throw new Error("PNG header is invalid");
      }
      sawHeader = true;
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8]!;
      colorType = data[9]!;
      interlace = data[12]!;
    } else if (type === "IDAT") {
      compressed.push(data);
    } else if (type === "tRNS") {
      hasTransparencyChunk = true;
    } else if (type === "IEND") {
      if (length !== 0) throw new Error("PNG end chunk is invalid");
      sawEnd = true;
      offset = chunkEnd;
      break;
    }
    offset = chunkEnd;
  }

  if (!sawHeader || !sawEnd || offset !== bytes.length || compressed.length === 0) {
    throw new Error("PNG structure is incomplete");
  }
  const policy = PRODUCT_TRANSPARENCY_INSPECTION_POLICY;
  if (
    width < 1 ||
    height < 1 ||
    width > policy.maximumDimension ||
    height > policy.maximumDimension ||
    width * height > policy.maximumDecodedPixels
  ) {
    return {
      status: "UNSUPPORTED",
      byteLength: bytes.length,
      width: width || undefined,
      height: height || undefined,
      transparencyState: "UNINSPECTABLE",
      reason: "PNG_DIMENSION_OR_PIXEL_BOUND_EXCEEDED",
    };
  }
  if (bitDepth !== 8 || interlace !== 0 || ![2, 6].includes(colorType)) {
    return {
      status: "UNSUPPORTED",
      byteLength: bytes.length,
      width,
      height,
      transparencyState: "UNINSPECTABLE",
      reason: "PNG_ENCODING_UNSUPPORTED",
    };
  }
  if (hasTransparencyChunk) {
    return {
      status: "UNSUPPORTED",
      byteLength: bytes.length,
      width,
      height,
      transparencyState: "UNINSPECTABLE",
      reason: "PNG_TRNS_TRANSPARENCY_UNSUPPORTED",
    };
  }

  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const stride = width * bytesPerPixel;
  const expectedInflatedLength = (stride + 1) * height;
  const inflated = inflateSync(Buffer.concat(compressed), {
    maxOutputLength: expectedInflatedLength,
  });
  if (inflated.length !== expectedInflatedLength) {
    throw new Error("PNG decoded length is invalid");
  }

  let sourceOffset = 0;
  let previous = Buffer.alloc(stride);
  let transparentPixels = 0;
  let boundaryPixels = 0;
  let transparentBoundaryPixels = 0;
  let fullyOpaque = true;

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[sourceOffset]!;
    const encodedRow = inflated.subarray(sourceOffset + 1, sourceOffset + 1 + stride);
    sourceOffset += stride + 1;
    const row = Buffer.alloc(stride);
    for (let index = 0; index < stride; index += 1) {
      const raw = encodedRow[index]!;
      const left = index >= bytesPerPixel ? row[index - bytesPerPixel]! : 0;
      const up = previous[index] ?? 0;
      const upperLeft = index >= bytesPerPixel ? previous[index - bytesPerPixel] ?? 0 : 0;
      if (filter === 0) row[index] = raw;
      else if (filter === 1) row[index] = (raw + left) & 0xff;
      else if (filter === 2) row[index] = (raw + up) & 0xff;
      else if (filter === 3) row[index] = (raw + Math.floor((left + up) / 2)) & 0xff;
      else if (filter === 4) row[index] = (raw + paeth(left, up, upperLeft)) & 0xff;
      else throw new Error("PNG scanline filter is unsupported");
    }
    previous = row;

    for (let x = 0; x < width; x += 1) {
      const alpha = colorType === 6 ? row[x * bytesPerPixel + 3]! : 255;
      const transparent = alpha <= policy.effectivelyTransparentAlphaMaximum;
      if (alpha !== 255) fullyOpaque = false;
      if (transparent) transparentPixels += 1;
      const boundary = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      if (boundary) {
        boundaryPixels += 1;
        if (transparent) transparentBoundaryPixels += 1;
      }
    }
  }

  const transparentPixelRatio = roundedRatio(transparentPixels, width * height);
  const boundaryTransparentPixelRatio = roundedRatio(
    transparentBoundaryPixels,
    boundaryPixels
  );
  const certified =
    transparentPixels >= policy.minimumTransparentPixelCount &&
    transparentPixelRatio >= policy.minimumTransparentPixelRatio &&
    boundaryTransparentPixelRatio >= policy.minimumBoundaryTransparentPixelRatio;
  return {
    status: "INSPECTED",
    byteLength: bytes.length,
    width,
    height,
    transparencyState: certified
      ? "CERTIFIED_TRANSPARENT_BACKGROUND"
      : fullyOpaque
        ? "FULLY_OPAQUE"
        : "INSUFFICIENT_TRANSPARENCY",
    transparentPixelRatio,
    boundaryTransparentPixelRatio,
  };
}

function inspectJpeg(bytes: Buffer): ProductImageByteInspection {
  if (
    bytes.length < 4 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes[bytes.length - 2] !== 0xff ||
    bytes[bytes.length - 1] !== 0xd9
  ) {
    throw new Error("JPEG signature is invalid");
  }
  let width: number | undefined;
  let height: number | undefined;
  let offset = 2;
  while (offset + 1 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++]!;
    if (marker === 0xd9) break;
    if (marker === 0x00 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) throw new Error("JPEG segment is truncated");
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) throw new Error("JPEG segment is invalid");
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (length < 7) throw new Error("JPEG frame header is invalid");
      height = bytes.readUInt16BE(offset + 3);
      width = bytes.readUInt16BE(offset + 5);
      break;
    }
    offset += length;
  }
  if (!width || !height) throw new Error("JPEG dimensions are unavailable");
  const policy = PRODUCT_TRANSPARENCY_INSPECTION_POLICY;
  if (
    width > policy.maximumDimension ||
    height > policy.maximumDimension ||
    width * height > policy.maximumDecodedPixels
  ) {
    return {
      status: "UNSUPPORTED",
      byteLength: bytes.length,
      width,
      height,
      transparencyState: "UNINSPECTABLE",
      reason: "JPEG_DIMENSION_OR_PIXEL_BOUND_EXCEEDED",
    };
  }
  return {
    status: "INSPECTED",
    byteLength: bytes.length,
    width,
    height,
    transparencyState: "FULLY_OPAQUE",
    transparentPixelRatio: 0,
    boundaryTransparentPixelRatio: 0,
  };
}

/**
 * Deterministic byte-level inspection only. It never claims that an opaque
 * background is simple, neutral, complex, or conflicting.
 */
export function inspectProductImageBytes(
  bytes: Buffer,
  mimeType: string
): ProductImageByteInspection {
  if (bytes.length > PRODUCT_TRANSPARENCY_INSPECTION_POLICY.maximumSourceBytes) {
    return {
      status: "UNSUPPORTED",
      byteLength: bytes.length,
      transparencyState: "UNINSPECTABLE",
      reason: "SOURCE_BYTE_BOUND_EXCEEDED",
    };
  }
  if (bytes.length === 0) {
    return {
      status: "FAILED",
      byteLength: 0,
      transparencyState: "UNINSPECTABLE",
      reason: "SOURCE_BYTES_EMPTY",
    };
  }
  try {
    const normalizedMimeType = mimeType.toLowerCase().split(";")[0]!.trim();
    if (normalizedMimeType === "image/png") {
      if (!bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
        throw new Error("PNG signature does not match declared media type");
      }
      return inspectPng(bytes);
    }
    if (normalizedMimeType === "image/jpeg" || normalizedMimeType === "image/jpg") {
      return inspectJpeg(bytes);
    }
    return {
      status: "UNSUPPORTED",
      byteLength: bytes.length,
      transparencyState: "UNINSPECTABLE",
      reason: "MEDIA_FORMAT_UNSUPPORTED",
    };
  } catch (error) {
    return {
      status: "FAILED",
      byteLength: bytes.length,
      transparencyState: "UNINSPECTABLE",
      reason: error instanceof Error ? error.message : "IMAGE_INSPECTION_FAILED",
    };
  }
}
