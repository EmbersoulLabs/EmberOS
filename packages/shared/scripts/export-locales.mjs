import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "../src/i18n/messages.ts"), "utf8");

function extractBlock(name) {
  const marker = name === "en" ? "const en = {" : `const ${name}: Record<keyof typeof en, string> = {`;
  const start = src.indexOf(marker);
  if (start < 0) throw new Error(`Missing ${name}`);
  let depth = 0;
  let i = src.indexOf("{", start);
  const begin = i;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const body = src.slice(begin, i + 1);
        return Function(`return ${body}`)();
      }
    }
  }
  throw new Error(`Unclosed block ${name}`);
}

const dir = join(__dirname, "../src/i18n/locales");
mkdirSync(dir, { recursive: true });

for (const loc of ["en", "zh", "ms"]) {
  const obj = extractBlock(loc);
  writeFileSync(join(dir, `${loc}.json`), `${JSON.stringify(obj, null, 2)}\n`);
  console.log(loc, Object.keys(obj).length);
}
