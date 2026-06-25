import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcFonts = join(root, "assets", "fonts");
const destFonts = join(root, "dist", "assets", "fonts");

mkdirSync(destFonts, { recursive: true });
cpSync(srcFonts, destFonts, { recursive: true });
console.log(`[worker] copied fonts → ${destFonts}`);
