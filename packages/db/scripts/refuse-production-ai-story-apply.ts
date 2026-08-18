/**
 * Fail-closed guard: AI Story overlay apply scripts must not mutate production.
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseSupabaseProjectRef,
  AI_STORY_PROD_MIGRATION_ACK,
  isAiStoryProductionRef,
} from "@ceo-agent/shared";

const here = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(here, "../../../apps/worker/.env") });
config({ path: resolve(here, "../../../.env.local") });

export function refuseProductionAiStoryApply(): void {
  const url = process.env.DATABASE_URL ?? "";
  const ref = parseSupabaseProjectRef(url);
  const ack = process.env.AI_STORY_PROD_MIGRATION_ACK;
  const allow = process.env.AI_STORY_PROD_MIGRATION_ALLOW === "true";
  if (isAiStoryProductionRef(ref) && !(allow && ack === AI_STORY_PROD_MIGRATION_ACK)) {
    console.error(
      "REFUSED: AI Story SQL apply against production requires AI_STORY_PROD_MIGRATION_ALLOW=true and AI_STORY_PROD_MIGRATION_ACK=AI_STORY_SELF_USE_V1. EXEC-02 does not apply schema."
    );
    process.exit(1);
  }
}

