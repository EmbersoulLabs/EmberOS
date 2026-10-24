import { describe, expect, it } from "vitest";
import {
  detectAllowedBusinessLogoImageType,
  isBusinessLogoMimeType,
} from "../apps/web/src/lib/business-logo-storage";

const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG_SIGNATURE = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const GIF_SIGNATURE = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0]);
const WEBP_SIGNATURE = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
]);
const SVG_BYTES = new TextEncoder().encode('<svg onload="alert(document.domain)"></svg>');
const HTML_BYTES = new TextEncoder().encode("<script>alert(1)</script>");

describe("business logo upload — stored XSS hardening", () => {
  it("no longer accepts image/svg+xml as a valid logo MIME type", () => {
    expect(isBusinessLogoMimeType("image/svg+xml")).toBe(false);
    expect(isBusinessLogoMimeType("IMAGE/SVG+XML")).toBe(false);
  });

  it("still accepts the raster formats it always supported", () => {
    for (const mime of ["image/jpeg", "image/png", "image/gif", "image/webp"]) {
      expect(isBusinessLogoMimeType(mime)).toBe(true);
    }
  });

  it("rejects an unrelated image/* subtype that was never explicitly allowlisted", () => {
    expect(isBusinessLogoMimeType("image/bmp")).toBe(false);
    expect(isBusinessLogoMimeType("image/vnd.adobe.photoshop")).toBe(false);
  });

  it("detects real raster signatures regardless of claimed MIME type", () => {
    expect(detectAllowedBusinessLogoImageType(PNG_SIGNATURE)).toBe("image/png");
    expect(detectAllowedBusinessLogoImageType(JPEG_SIGNATURE)).toBe("image/jpeg");
    expect(detectAllowedBusinessLogoImageType(GIF_SIGNATURE)).toBe("image/gif");
    expect(detectAllowedBusinessLogoImageType(WEBP_SIGNATURE)).toBe("image/webp");
  });

  it("refuses SVG/HTML bytes even if the client lied about the MIME type", () => {
    // This is the actual attack: claim `file.type: "image/png"` while
    // uploading an SVG with an inline script. Byte-level detection must
    // reject it regardless of what the client said.
    expect(detectAllowedBusinessLogoImageType(SVG_BYTES)).toBeNull();
    expect(detectAllowedBusinessLogoImageType(HTML_BYTES)).toBeNull();
  });

  it("refuses empty or truncated byte buffers", () => {
    expect(detectAllowedBusinessLogoImageType(new Uint8Array(0))).toBeNull();
    expect(detectAllowedBusinessLogoImageType(Uint8Array.from([0x89, 0x50]))).toBeNull();
  });
});
