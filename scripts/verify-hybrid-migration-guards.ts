import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { evaluateMigration, type MigrationIntent } from "./hybrid-migration-guards";

function argument(name: string, fallback?: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const base = argument("base", process.env.MIGRATION_BASE_REVISION ?? "origin/main");
const head = argument("head", process.env.MIGRATION_HEAD_REVISION ?? "HEAD");
const intentPath = argument("intent", process.env.MIGRATION_INTENT);

if (!base || !head || !intentPath) {
  console.error("Usage: tsx scripts/verify-hybrid-migration-guards.ts --base <rev> --head <rev> --intent <file>");
  process.exit(2);
}

function git(args: string[]) {
  return execFileSync("git", args, { encoding: "utf8" });
}

const changedFiles = git(["diff", "--name-only", `${base}...${head}`])
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);
const addedLines = git(["diff", "--unified=0", `${base}...${head}`])
  .split(/\r?\n/)
  .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
  .map((line) => line.slice(1));
const intent = JSON.parse(readFileSync(resolve(intentPath), "utf8")) as MigrationIntent;
const result = evaluateMigration({ changedFiles, addedLines, intent });

console.log(JSON.stringify({ base, head, intent: intentPath, ...result }, null, 2));
if (!result.ok) process.exit(1);
