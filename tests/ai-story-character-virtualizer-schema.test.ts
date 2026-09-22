import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const PG_IDENTIFIER_LIMIT = 63;
const schema = readFileSync(resolve(process.cwd(), "packages/db/src/schema/index.ts"), "utf8");
const sql = readFileSync(resolve(process.cwd(), "packages/db/sql/ai-story-character-virtualizer-v1.sql"), "utf8");
const schemaBlock = schema.slice(
  schema.indexOf("export const aiStoryCharacterVirtualizationJobs"),
  schema.indexOf("export const aiStoryLocations"),
);

const requiredFkNames = [
  "as_cvj_org_fk",
  "as_cvj_ws_fk",
  "as_cvj_source_asset_fk",
  "as_cvj_output_asset_fk",
  "as_cvj_parent_fk",
  "as_cvj_rc_fk",
  "as_cvj_rc_ver_fk",
];

describe("Character Virtualizer Drizzle FK identifiers", () => {
  it("uses unique short restrict FKs that cannot truncate-collide", () => {
    const drizzleNames = [...schemaBlock.matchAll(/foreignKey\(\{\s*name:\s*"([^"]+)"/g)].map((match) => match[1]);
    expect(drizzleNames).toEqual(requiredFkNames);
    expect(new Set(drizzleNames).size).toBe(drizzleNames.length);
    for (const name of drizzleNames) {
      expect(name.length).toBeLessThanOrEqual(PG_IDENTIFIER_LIMIT);
    }
    expect(schemaBlock).not.toMatch(/\.references\(/);
    expect([...schemaBlock.matchAll(/\.onDelete\("restrict"\)/g)]).toHaveLength(requiredFkNames.length);
  });

  it("keeps SQL overlay FK names aligned", () => {
    const sqlNames = [...sql.matchAll(/CONSTRAINT\s+(\S+_fk)\s/g)].map((match) => match[1]);
    expect(sqlNames.sort()).toEqual([...requiredFkNames].sort());
    expect(sql).toMatch(/ON DELETE RESTRICT/g);
    expect(sql).not.toMatch(/ON DELETE CASCADE/);
  });
});
