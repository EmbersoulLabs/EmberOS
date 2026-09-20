import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import {
  CertificationCommercialAuthorityService,
  closeDb,
} from "../src/index.ts";
import {
  parseSupabaseProjectRef,
  isAiStoryProductionRef,
} from "@ceo-agent/shared";
import {
  CERTIFIED_BYTEPLUS_SEEDANCE_20_PRICING_VERSION,
  estimateProviderCostUsd,
} from "@ceo-agent/shared/server";

const here = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(here, "../../../apps/worker/.env") });
config({ path: resolve(here, "../../../.env.local") });

const AUTHORIZATION = "AI_STORY_I2V_PRODUCTION_PRICE_PROVISION_AUTHORIZED";

/**
 * Deterministic Production I2V USD price provisioner.
 * Does not run on Worker startup. Requires explicit human authorization.
 * Idempotent: same sibling identity and official source/version/rate.
 */
async function main() {
  if (process.env.AI_STORY_PROVISION_PRODUCTION_I2V_PRICE !== AUTHORIZATION) {
    throw new Error(
      "REFUSED: Production I2V price provision requires AI_STORY_PROVISION_PRODUCTION_I2V_PRICE=" +
        AUTHORIZATION
    );
  }
  const url = process.env.DATABASE_URL?.trim() ?? "";
  if (!url) throw new Error("DATABASE_URL is required");
  const ref = parseSupabaseProjectRef(url);
  if (!isAiStoryProductionRef(ref)) {
    throw new Error("REFUSED: this provisioner may only target the Production AI Story database");
  }
  if (process.env.AI_STORY_CERTIFICATION_ENVIRONMENT !== "PRODUCTION") {
    throw new Error("AI_STORY_CERTIFICATION_ENVIRONMENT must be PRODUCTION");
  }

  const commercial = new CertificationCommercialAuthorityService();
  const at = new Date().toISOString();
  const result = await commercial.provisionCertifiedSeedanceFirstFrameI2vSiblingFromMatchingT2v({
    durationSeconds: 4,
    aspectRatio: "9:16",
    resolution: "480p",
    at,
  });
  if (result.source.version !== CERTIFIED_BYTEPLUS_SEEDANCE_20_PRICING_VERSION) {
    throw new Error("Source T2V pricing version is not the certified official Seedance version");
  }
  console.log(JSON.stringify({
    replayed: result.replayed,
    sourcePricingRuleId: result.source.providerUsdPricingRuleId,
    i2vPricingRuleId: result.rule.providerUsdPricingRuleId,
    generationMode: result.rule.generationMode,
    version: result.rule.version,
    sourceUrl: result.rule.sourceUrl,
    usdPerMillionTokens: result.rule.usdPerMillionTokens,
    estimatedCostUsd: estimateProviderCostUsd(result.rule),
  }, null, 2));
}

main().catch(async (error) => {
  console.error(error);
  await closeDb().catch(() => undefined);
  process.exit(1);
}).then(async () => {
  await closeDb();
});
