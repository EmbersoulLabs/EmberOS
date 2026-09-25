import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const PG_IDENTIFIER_LIMIT = 63;
const schema = readFileSync(resolve(process.cwd(), "packages/db/src/schema/index.ts"), "utf8");
const sql = readFileSync(resolve(process.cwd(), "packages/db/sql/ai-story-character-dna-from-photo-v1.sql"), "utf8");
const securitySql = readFileSync(
  resolve(process.cwd(), "packages/db/sql/ai-story-character-dna-analysis-jobs-server-only-rls-v1.sql"),
  "utf8"
);
const schemaBlock = schema.slice(
  schema.indexOf("export const aiStoryCharacterDnaAnalysisJobs"),
  schema.indexOf("export const aiStoryLocations"),
);

const requiredFkNames = [
  "as_cdj_org_fk",
  "as_cdj_ws_fk",
  "as_cdj_source_asset_fk",
  "as_cdj_rc_fk",
  "as_cdj_rc_ver_fk",
];

describe("Character DNA Drizzle FK identifiers", () => {
  it("uses unique short restrict FKs that cannot truncate-collide", () => {
    const drizzleNames = [...schemaBlock.matchAll(/foreignKey\(\{\s*name:\s*"([^"]+)"/g)].map((match) => match[1]);
    expect(drizzleNames).toEqual(requiredFkNames);
    expect(new Set(drizzleNames).size).toBe(drizzleNames.length);
    for (const name of drizzleNames) {
      expect(name.length).toBeLessThanOrEqual(PG_IDENTIFIER_LIMIT);
    }
    expect(schemaBlock).not.toMatch(/\.references\(/);
    expect([...schemaBlock.matchAll(/\.onDelete\("restrict"\)/g)]).toHaveLength(requiredFkNames.length);
    expect(sql).toContain("image_generation_calls integer NOT NULL CHECK (image_generation_calls = 0)");
    expect(sql).toContain("gpt_image_calls integer NOT NULL CHECK (gpt_image_calls = 0)");
    expect(sql).toContain("seedance_video_calls integer NOT NULL CHECK (seedance_video_calls = 0)");
    expect(sql).toContain("CHARACTER_DNA_ANALYSIS");
  });

  it("keeps analysis jobs server-only behind RLS and zero client grants", () => {
    expect(securitySql).toMatch(/ALTER TABLE public\.ai_story_character_dna_analysis_jobs\s+ENABLE ROW LEVEL SECURITY/i);
    expect(securitySql).toMatch(/REVOKE ALL PRIVILEGES ON TABLE public\.ai_story_character_dna_analysis_jobs\s+FROM anon, authenticated/i);
    expect(securitySql).not.toMatch(/CREATE POLICY/i);
    expect(securitySql).not.toMatch(/USING\s*\(\s*true\s*\)/i);
    expect(securitySql).not.toMatch(/WITH CHECK\s*\(\s*true\s*\)/i);
  });
});
