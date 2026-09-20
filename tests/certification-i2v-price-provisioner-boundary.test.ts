import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Production I2V price provisioner boundary", () => {
  it("stays an explicit authorized script and is never Worker-started", () => {
    const script = readFileSync(
      resolve(
        process.cwd(),
        "packages/db/scripts/provision-production-seedance-i2v-usd-price-v1.ts"
      ),
      "utf8"
    );
    const worker = readFileSync(
      resolve(process.cwd(), "apps/worker/src/index.ts"),
      "utf8"
    );
    expect(script).toContain("provisionCertifiedSeedanceFirstFrameI2vSiblingFromMatchingT2v");
    expect(script).toContain("AI_STORY_I2V_PRODUCTION_PRICE_PROVISION_AUTHORIZED");
    expect(script).toContain("isAiStoryProductionRef");
    expect(worker).not.toContain("provisionCertifiedSeedanceFirstFrameI2vSiblingFromMatchingT2v");
    expect(worker).not.toContain("provisionPrice");
  });
});
