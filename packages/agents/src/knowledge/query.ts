import type { Industry, KnowledgeSnippet, Platform } from "@ceo-agent/shared";
import floristSeed from "./seed/florist.json";
import weddingSeed from "./seed/wedding.json";
import b2bSaasSeed from "./seed/b2b_saas.json";

type SeedFile = {
  industry: string;
  locale: string;
  hooks: { type: string; text: string }[];
  ctas: string[];
  angles: string[];
  templates: string[];
};

const SEEDS: Record<string, SeedFile> = {
  florist: floristSeed as SeedFile,
  wedding: weddingSeed as SeedFile,
  b2b_saas: b2bSaasSeed as SeedFile,
};

const INDUSTRY_ALIASES: Record<string, keyof typeof SEEDS> = {
  erp: "b2b_saas",
  saas: "b2b_saas",
  software: "b2b_saas",
  b2b: "b2b_saas",
};

/** Industries we can infer; only a subset have seeded JSON templates. */
export const KNOWN_INDUSTRIES = [
  "florist",
  "wedding",
  "restaurant",
  "retail",
  "beauty",
  "real_estate",
  "phone_buyback",
  "b2b_saas",
  "general",
] as const satisfies readonly Industry[];

export function hasKnowledgeSeed(industry: Industry): boolean {
  return resolveSeedKey(industry) !== null;
}

function resolveSeedKey(industry: Industry): keyof typeof SEEDS | null {
  if (industry in SEEDS) return industry as keyof typeof SEEDS;
  if (industry in INDUSTRY_ALIASES) return INDUSTRY_ALIASES[industry]!;
  return null;
}

export function inferIndustry(
  goal: string,
  extraContext?: string,
  brandIndustry?: string
): Industry {
  const text = `${goal} ${extraContext ?? ""} ${brandIndustry ?? ""}`.toLowerCase();

  if (/erp|进销存|企业管理|saas|软件系统|crm|财务系统|库存管理|odoo|用友|金蝶|数字化转型|b2b/.test(text)) {
    return "b2b_saas";
  }
  if (/婚|wedding|新娘|婚车/.test(text)) return "wedding";
  if (/花|florist|花艺|花束|布置/.test(text)) return "florist";
  if (/餐|restaurant|美食/.test(text)) return "restaurant";
  if (/零售|retail|shop/.test(text)) return "retail";
  if (/美|beauty|护肤|化妆/.test(text)) return "beauty";
  if (/房|property|real.?estate/.test(text)) return "real_estate";
  if (/手机|phone|buyback|回收/.test(text)) return "phone_buyback";

  const brand = brandIndustry?.toLowerCase().trim();
  if (brand) {
    if (brand in INDUSTRY_ALIASES) return "b2b_saas";
    if ((KNOWN_INDUSTRIES as readonly string[]).includes(brand)) return brand as Industry;
  }

  return "general";
}

export function queryKnowledge(
  industry: Industry,
  locale = "zh-CN",
  limit = 8
): KnowledgeSnippet[] {
  const seedKey = resolveSeedKey(industry);
  const seeds: SeedFile[] = [];
  if (seedKey && SEEDS[seedKey]) seeds.push(SEEDS[seedKey]!);

  if (seeds.length === 0) return [];

  const snippets: KnowledgeSnippet[] = [];
  for (const seed of seeds) {
    for (const h of seed.hooks) {
      snippets.push({
        category: "hook",
        hookType: h.type as KnowledgeSnippet["hookType"],
        text: h.text,
        locale: seed.locale,
      });
    }
    for (const c of seed.ctas) {
      snippets.push({ category: "cta", text: c, locale: seed.locale });
    }
    for (const a of seed.angles) {
      snippets.push({ category: "angle", text: a, locale: seed.locale });
    }
    for (const t of seed.templates) {
      snippets.push({ category: "template", text: t, locale: seed.locale });
    }
  }

  const zh = locale.startsWith("zh");
  return snippets
    .filter((s) => (zh ? s.locale.startsWith("zh") : true))
    .slice(0, limit);
}

export function formatKnowledgeForPrompt(snippets: KnowledgeSnippet[]): string {
  if (snippets.length === 0) {
    return "No seeded industry templates. Infer audience, pain points, hooks, and CTA from campaign goal, name, brand profile, and inferred industry only.";
  }
  return snippets
    .map((s) => `[${s.category}${s.hookType ? `:${s.hookType}` : ""}] ${s.text}`)
    .join("\n");
}

export function defaultPlatformPriority(platforms: string[]): Platform[] {
  const order = ["xiaohongshu", "tiktok", "instagram", "douyin"] as Platform[];
  const selected = platforms.filter((p): p is Platform =>
    order.includes(p as Platform)
  ) as Platform[];
  return selected.length > 0 ? selected : ["xiaohongshu", "tiktok"];
}
