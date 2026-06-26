import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { marketingEn, marketingZh, marketingMs } from "./marketing-i18n-additions.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dir = join(__dirname, "../src/i18n/locales");

function merge(locale, additions) {
  const path = join(dir, `${locale}.json`);
  const current = JSON.parse(readFileSync(path, "utf8"));
  const merged = { ...current, ...additions };
  const keys = Object.keys(merged).sort();
  const sorted = {};
  for (const k of keys) sorted[k] = merged[k];
  writeFileSync(path, `${JSON.stringify(sorted, null, 2)}\n`);
  console.log(locale, Object.keys(additions).length, "added →", Object.keys(sorted).length, "total");
}

merge("en", marketingEn);
merge("zh", marketingZh);
merge("ms", marketingMs);
