import { describe, expect, it } from "vitest";
import { isAllowedExternalBgmAudioUrl } from "@ceo-agent/shared";

describe("isAllowedExternalBgmAudioUrl — SSRF guard", () => {
  it("allows real Jamendo CDN URLs", () => {
    expect(isAllowedExternalBgmAudioUrl("https://prod-1.storage.jamendo.com/track123.mp3")).toBe(true);
    expect(isAllowedExternalBgmAudioUrl("https://jamendo.com/track123.mp3")).toBe(true);
    expect(isAllowedExternalBgmAudioUrl("http://mp3l.jamendo.com/track123.mp3")).toBe(true);
  });

  it("rejects the cloud metadata endpoint", () => {
    expect(isAllowedExternalBgmAudioUrl("http://169.254.169.254/latest/meta-data/")).toBe(false);
  });

  it("rejects localhost and loopback addresses", () => {
    expect(isAllowedExternalBgmAudioUrl("http://localhost:6379/")).toBe(false);
    expect(isAllowedExternalBgmAudioUrl("http://127.0.0.1:8080/admin")).toBe(false);
  });

  it("rejects private network ranges", () => {
    expect(isAllowedExternalBgmAudioUrl("http://10.0.0.5/internal")).toBe(false);
    expect(isAllowedExternalBgmAudioUrl("http://192.168.1.1/")).toBe(false);
  });

  it("rejects a lookalike host that merely contains 'jamendo'", () => {
    expect(isAllowedExternalBgmAudioUrl("https://jamendo.com.evil.example/track.mp3")).toBe(false);
    expect(isAllowedExternalBgmAudioUrl("https://notjamendo.com/track.mp3")).toBe(false);
    expect(isAllowedExternalBgmAudioUrl("https://evil.com/?jamendo.com")).toBe(false);
  });

  it("rejects non-http(s) schemes and malformed URLs", () => {
    expect(isAllowedExternalBgmAudioUrl("file:///etc/passwd")).toBe(false);
    expect(isAllowedExternalBgmAudioUrl("not a url")).toBe(false);
    expect(isAllowedExternalBgmAudioUrl("")).toBe(false);
  });
});
