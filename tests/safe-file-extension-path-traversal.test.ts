import { describe, expect, it } from "vitest";
import { safeFileExtension } from "@ceo-agent/shared";
import { join } from "node:path";

describe("safeFileExtension — path traversal guard", () => {
  it("passes through a normal extension unchanged", () => {
    expect(safeFileExtension("mp4")).toBe("mp4");
    expect(safeFileExtension("PNG")).toBe("png");
  });

  it("strips embedded path traversal segments down to alphanumerics", () => {
    // This is exactly what `"a.mp4/../../../../../../etc/passwd".split(".").pop()`
    // produces: "mp4/../../../../../../etc/passwd".
    const malicious = "mp4/../../../../../../etc/passwd";
    const result = safeFileExtension(malicious);
    expect(result).not.toContain("/");
    expect(result).not.toContain("..");
    expect(result).toBe("mp4etcpa");
  });

  it("joining the sanitized extension can never escape the intended directory", () => {
    const malicious = "mp4/../../../../../../etc/passwd";
    const ext = safeFileExtension(malicious, "mp4");
    const workDir = join("/tmp", "work-123");
    const localPath = join(workDir, `part-0.${ext}`);
    expect(localPath.startsWith(workDir)).toBe(true);
  });

  it("falls back to the provided default when nothing alphanumeric survives", () => {
    expect(safeFileExtension("../../../", "mp4")).toBe("mp4");
    expect(safeFileExtension("", "bin")).toBe("bin");
  });

  it("caps extremely long candidates", () => {
    expect(safeFileExtension("a".repeat(100)).length).toBeLessThanOrEqual(8);
  });
});
