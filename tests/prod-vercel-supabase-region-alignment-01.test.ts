import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const webVercel = JSON.parse(readFileSync("apps/web/vercel.json", "utf8")) as {
  readonly regions?: readonly string[];
};
const dbClient = readFileSync("packages/db/src/client.ts", "utf8").replace(/\r\n/g, "\n");

describe("Vercel and Supabase production region alignment", () => {
  it("requests one Singapore region for the complete Web project", () => {
    expect(webVercel.regions).toEqual(["sin1"]);
  });

  it("preserves the certified transaction-pooler-compatible DB client", () => {
    expect(dbClient).toContain("prepare: false");
    expect(dbClient).toContain("SERVERLESS_DB_MAX_CONNECTIONS = 3");
    expect(dbClient).toContain("isServerless ? SERVERLESS_DB_MAX_CONNECTIONS : 10");
    expect(dbClient).toContain("idle_timeout: 20");
    expect(dbClient).toContain("connect_timeout: connectTimeout");
  });
});
