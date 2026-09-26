import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "packages/db/sql/ai-story-outline-profile-authorities-v1.sql"),
  "utf8",
);

describe("AI Story canonical profile persistence convergence", () => {
  it.each(["CORE", "PRODUCT_STORY", "COMMERCIAL_STORY"])(
    "authorizes the certified %s profile for Outline and Script persistence",
    (profileId) => {
      const occurrences = migration.match(new RegExp(`'${profileId}'`, "g")) ?? [];
      expect(occurrences).toHaveLength(2);
    },
  );

  it("replaces only the two stale profile checks without touching authority rows", () => {
    expect(migration).toContain("DROP CONSTRAINT IF EXISTS ai_story_outline_profile_id_check");
    expect(migration).toContain("ADD CONSTRAINT ai_story_outline_profile_id_check");
    expect(migration).toContain("DROP CONSTRAINT IF EXISTS ai_story_script_profile_check");
    expect(migration).toContain("ADD CONSTRAINT ai_story_script_profile_check");
    expect(migration).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
  });

  it("does not introduce an open-ended profile predicate", () => {
    expect(migration).not.toMatch(/profile_id\s+IS\s+NOT\s+NULL/i);
    expect(migration).not.toMatch(/CHECK\s*\(\s*true\s*\)/i);
  });
});

