import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const PG_IDENTIFIER_LIMIT = 63;
const schema = readFileSync(resolve(process.cwd(), "packages/db/src/schema/index.ts"), "utf8");
const sql = readFileSync(resolve(process.cwd(), "packages/db/sql/ai-story-reusable-character-v1.sql"), "utf8");
const schemaBlock = schema.slice(
  schema.indexOf("export const aiStoryReusableCharacters"),
  schema.indexOf("export const aiStorySupportingCharacters"),
);

const requiredFkNames = [
  "as_rc_root_org_fk",
  "as_rc_root_ws_fk",
  "as_rc_ver_root_fk",
  "as_rc_ver_org_fk",
  "as_rc_ver_ws_fk",
  "as_rc_ver_supersede_fk",
  "as_rc_proj_org_fk",
  "as_rc_proj_ws_fk",
  "as_rc_proj_root_fk",
  "as_rc_proj_ver_fk",
  "as_rc_proj_campaign_fk",
  "as_rc_proj_char_fk",
  "as_rc_proj_char_ver_fk",
  "as_ep_char_bind_org_fk",
  "as_ep_char_bind_ws_fk",
  "as_ep_char_bind_story_fk",
  "as_ep_char_bind_root_fk",
  "as_ep_char_bind_ver_fk",
  "as_ep_char_bind_char_fk",
  "as_ep_char_bind_char_ver_fk",
  "as_char_anchor_org_fk",
  "as_char_anchor_ws_fk",
  "as_char_anchor_root_fk",
  "as_char_anchor_ver_fk",
  "as_char_anchor_story_fk",
  "as_char_anchor_asset_fk",
];

function namedForeignKeys(source: string): string[] {
  return [...source.matchAll(/\bname:\s*"([^"]+_fk)"/g), ...source.matchAll(/\bCONSTRAINT\s+(\S+_fk)\s/g)]
    .map((match) => match[1])
    .filter((name) => requiredFkNames.includes(name) || name.startsWith("as_"));
}

describe("reusable Character Drizzle FK identifiers", () => {
  it("uses unique short restrict FKs that cannot truncate-collide", () => {
    const drizzleNames = [...schemaBlock.matchAll(/foreignKey\(\{\s*name:\s*"([^"]+)"/g)].map((match) => match[1]);
    expect(drizzleNames).toEqual(requiredFkNames);
    expect(new Set(drizzleNames).size).toBe(drizzleNames.length);
    for (const name of drizzleNames) {
      expect(name.length).toBeLessThanOrEqual(PG_IDENTIFIER_LIMIT);
    }
    expect(schemaBlock).not.toMatch(/\.references\(/);
    expect([...schemaBlock.matchAll(/\.onDelete\("restrict"\)/g)]).toHaveLength(requiredFkNames.length);
    expect(schemaBlock).not.toContain("currentReusableCharacterVersionId: uuid(\"current_reusable_character_version_id\").notNull().references");
    expect(schemaBlock).toContain("as_rc_proj_root_fk");
    expect(schemaBlock).toContain("as_rc_proj_ver_fk");
    expect(schemaBlock).toContain("as_rc_proj_char_fk");
    expect(schemaBlock).toContain("as_rc_proj_char_ver_fk");
  });

  it("keeps SQL overlay FK names aligned without deferred current-version Drizzle FK", () => {
    const sqlNames = namedForeignKeys(sql).filter((name) => name !== "ai_story_reusable_character_current_version_fk");
    expect(sqlNames.sort()).toEqual([...requiredFkNames].sort());
    expect(sql).toContain("CONSTRAINT ai_story_reusable_character_current_version_fk");
    expect(sql).toContain("REFERENCES ai_story_reusable_character_versions(reusable_character_version_id) DEFERRABLE INITIALLY DEFERRED");
    expect(sql).toMatch(/ON DELETE RESTRICT/g);
    expect(sql).not.toMatch(/ON DELETE CASCADE/);
    expect(schema).toContain('uniqueIndex("campaigns_workspace_creation_idempotency_idx")');
  });
});
