import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

describe("VS-RC-TEST-01 permanent product-loop harness contract", () => {
  it("exposes a fail-closed release command that is not a default unit test", () => {
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    expect(pkg.scripts["test:video-studio:product-loop"]).toBe(
      "tsx scripts/run-video-studio-product-loop.ts"
    );
    expect(pkg.scripts.test).not.toContain("test:video-studio:product-loop");
    expect(pkg.scripts["test:integration"]).not.toContain("video-studio-product-loop");
  });

  it("blocks on missing environment instead of skipping MUST scenarios", () => {
    const runner = read("scripts/run-video-studio-product-loop.ts");
    const preflight = read("scripts/video-studio-product-loop-preflight.ts");
    const integration = read("tests/vs-rc-test-01-product-loop.integration.test.ts");

    expect(runner).toContain("ENVIRONMENT_BLOCKED");
    expect(runner).toContain("process.exit(2)");
    expect(runner).toContain("PRODUCT_FAILURE");
    expect(preflight).toContain("TEST_GATE_BLOCKED");
    expect(integration).not.toMatch(/describe\.skip|it\.skip|test\.skip/);
    expect(integration).toContain("ENVIRONMENT_BLOCKED");
  });
});
