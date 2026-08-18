import { deflateSync, inflateSync } from "node:zlib";
import {
  EXTRACTED_MAX_BYTES,
  EXTRACTED_MAX_DIMENSION,
  EXTRACTED_PRODUCT_MIME,
  PhotoSceneExtractionError,
} from "@ceo-agent/shared";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]!) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crcBuf]);
}

export function encodeRgbaPng(width: number, height: number, rgba: Buffer): Buffer {
  if (width < 1 || height < 1 || rgba.length !== width * height * 4) {
    throw new PhotoSceneExtractionError("INVALID_PROVIDER_OUTPUT", "RGBA PNG dimensions are invalid");
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    const start = y * width * 4;
    rows.push(Buffer.concat([Buffer.from([0]), rgba.subarray(start, start + width * 4)]));
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(Buffer.concat(rows))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

export type ValidatedExtractedPng = {
  mimeType: typeof EXTRACTED_PRODUCT_MIME;
  width: number;
  height: number;
  hasAlpha: true;
  byteLength: number;
};

export function validateExtractedPng(bytes: Buffer): ValidatedExtractedPng {
  if (!bytes?.length) {
    throw new PhotoSceneExtractionError("INVALID_PROVIDER_OUTPUT", "Extracted output is empty");
  }
  if (bytes.length > EXTRACTED_MAX_BYTES) {
    throw new PhotoSceneExtractionError("INVALID_PROVIDER_OUTPUT", "Extracted output exceeds size bound");
  }
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new PhotoSceneExtractionError("INVALID_PROVIDER_OUTPUT", "Extracted output is not a PNG");
  }
  const ihdrType = bytes.subarray(12, 16).toString("ascii");
  if (ihdrType !== "IHDR") {
    throw new PhotoSceneExtractionError("INVALID_PROVIDER_OUTPUT", "Extracted PNG is missing IHDR");
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  const colorType = bytes[25];
  if (width < 1 || height < 1 || width > EXTRACTED_MAX_DIMENSION || height > EXTRACTED_MAX_DIMENSION) {
    throw new PhotoSceneExtractionError("INVALID_PROVIDER_OUTPUT", "Extracted PNG dimensions are invalid");
  }
  let hasAlpha = colorType === 4 || colorType === 6;
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    if (type === "tRNS") hasAlpha = true;
    if (type === "IEND") break;
    offset += 12 + length;
  }
  if (!hasAlpha) {
    throw new PhotoSceneExtractionError(
      "INVALID_PROVIDER_OUTPUT",
      "Extracted PNG must include an alpha channel"
    );
  }
  return {
    mimeType: EXTRACTED_PRODUCT_MIME,
    width,
    height,
    hasAlpha: true,
    byteLength: bytes.length,
  };
}

export type DecodedRgbaPng = {
  width: number;
  height: number;
  rgba: Buffer;
};

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function unfilterScanline(
  filter: number,
  row: Buffer,
  prev: Buffer,
  bpp: number
): Buffer {
  const out = Buffer.alloc(row.length);
  for (let i = 0; i < row.length; i++) {
    const raw = row[i]!;
    const left = i >= bpp ? out[i - bpp]! : 0;
    const up = prev[i] ?? 0;
    const upLeft = i >= bpp ? prev[i - bpp] ?? 0 : 0;
    let recon: number;
    switch (filter) {
      case 0:
        recon = raw;
        break;
      case 1:
        recon = (raw + left) & 0xff;
        break;
      case 2:
        recon = (raw + up) & 0xff;
        break;
      case 3:
        recon = (raw + Math.floor((left + up) / 2)) & 0xff;
        break;
      case 4:
        recon = (raw + paeth(left, up, upLeft)) & 0xff;
        break;
      default:
        throw new Error("Unsupported PNG filter");
    }
    out[i] = recon;
  }
  return out;
}

/** Decode 8-bit RGB/RGBA PNG (no interlacing) into straight RGBA. */
export function decodeRgbaPng(bytes: Buffer): DecodedRgbaPng {
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("Input is not a PNG");
  }
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat: Buffer[] = [];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8]!;
      colorType = data[9]!;
      const interlace = data[12]!;
      if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6) || interlace !== 0) {
        throw new Error("PNG must be 8-bit RGB or RGBA without interlacing");
      }
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  if (width < 1 || height < 1) throw new Error("PNG IHDR is missing");
  const inflated = inflateSync(Buffer.concat(idat));
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const rgba = Buffer.alloc(width * height * 4);
  let src = 0;
  let prev: Buffer = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = inflated[src]!;
    const row = inflated.subarray(src + 1, src + 1 + stride);
    src += 1 + stride;
    const recon = unfilterScanline(filter, row, prev, bpp);
    prev = Buffer.from(recon);
    for (let x = 0; x < width; x++) {
      const di = (y * width + x) * 4;
      const si = x * bpp;
      rgba[di] = recon[si]!;
      rgba[di + 1] = recon[si + 1]!;
      rgba[di + 2] = recon[si + 2]!;
      rgba[di + 3] = bpp === 4 ? recon[si + 3]! : 255;
    }
  }
  return { width, height, rgba };
}
