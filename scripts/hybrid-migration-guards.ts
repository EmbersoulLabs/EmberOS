import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export type MigrationIntent = {
  ticketId: string;
  wave: number;
  changeKind: "HYBRID_MIGRATION" | "PRODUCTION_CORRECTNESS_REPAIR" | "SECURITY_REPAIR" | "GOVERNANCE";
  reason: string;
  sourceAuthority: "origin/main" | "origin/staging" | "BLUEPRINT" | "SECURITY_AUDIT";
  targetModule: string;
  allowedSourcePaths: string[];
  allowedTargetPaths: string[];
  protectedDomainsExpectedToChange: string[];
  protectedDomainsMustNotChange: string[];
  requiredTests: string[];
  blueprintBaselineId: string;
};

type GuardManifest = {
  version: string;
  blueprintBaselineId: string;
  classifications: Array<{ name: string; patterns: string[] }>;
  protectedDomains: Record<string, { patterns: string[]; requiredTests: string[] }>;
  forbiddenStagingSurfaces: string[];
  waveScopes: Record<string, string[]>;
  preWave6SkillTokens: string[];
};

export type GuardInput = {
  changedFiles: string[];
  addedLines?: string[];
  intent: MigrationIntent;
  manifest?: GuardManifest;
};

export type GuardResult = {
  ok: boolean;
  errors: string[];
  classifications: Record<string, string>;
  protectedDomainsTouched: string[];
};

export function loadGuardManifest(path = resolve("config/hybrid-migration-guards.json")): GuardManifest {
  return JSON.parse(readFileSync(path, "utf8")) as GuardManifest;
}

function normalize(path: string) {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function globRegex(pattern: string) {
  const source = normalize(pattern)
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replaceAll("**", "\u0000")
    .replaceAll("*", "[^/]*")
    .replaceAll("\u0000", ".*");
  return new RegExp(`^${source}$`);
}

export function matchesAny(path: string, patterns: string[]) {
  const normalized = normalize(path);
  return patterns.some((pattern) => globRegex(pattern).test(normalized));
}

function validateIntent(intent: MigrationIntent, manifest: GuardManifest, errors: string[]) {
  if (!intent.ticketId?.trim()) errors.push("INTENT_TICKET_REQUIRED");
  if (!Number.isInteger(intent.wave) || intent.wave < 0 || intent.wave > 6) errors.push("INTENT_WAVE_INVALID");
  if (!intent.reason || intent.reason.trim().length < 12) errors.push("INTENT_REASON_REQUIRED");
  if (intent.blueprintBaselineId !== manifest.blueprintBaselineId) errors.push("BLUEPRINT_BASELINE_MISMATCH");
  for (const field of ["allowedSourcePaths", "allowedTargetPaths", "protectedDomainsExpectedToChange", "protectedDomainsMustNotChange", "requiredTests"] as const) {
    if (!Array.isArray(intent[field])) errors.push(`INTENT_${field.toUpperCase()}_REQUIRED`);
  }
}

export function evaluateMigration(input: GuardInput): GuardResult {
  const manifest = input.manifest ?? loadGuardManifest();
  const errors: string[] = [];
  const classifications: Record<string, string> = {};
  const touched = new Set<string>();
  const changedFiles = [...new Set(input.changedFiles.map(normalize))];

  validateIntent(input.intent, manifest, errors);
  const wavePatterns = manifest.waveScopes[String(input.intent.wave)] ?? [];

  for (const file of changedFiles) {
    const classification = manifest.classifications.find((rule) => matchesAny(file, rule.patterns));
    if (!classification) errors.push(`UNCLASSIFIED_CHANGED_FILE:${file}`);
    else classifications[file] = classification.name;

    if (!matchesAny(file, input.intent.allowedTargetPaths)) errors.push(`TARGET_PATH_NOT_DECLARED:${file}`);
    if (!matchesAny(file, wavePatterns)) errors.push(`WAVE_${input.intent.wave}_SCOPE_VIOLATION:${file}`);

    for (const [domain, contract] of Object.entries(manifest.protectedDomains)) {
      if (matchesAny(file, contract.patterns)) touched.add(domain);
    }

    if (input.intent.sourceAuthority === "origin/staging" && matchesAny(file, manifest.forbiddenStagingSurfaces)) {
      errors.push(`FORBIDDEN_STAGING_SURFACE:${file}`);
    }
  }

  for (const domain of touched) {
    if (input.intent.protectedDomainsMustNotChange.includes(domain)) errors.push(`PROTECTED_DOMAIN_MUST_NOT_CHANGE:${domain}`);
    if (!input.intent.protectedDomainsExpectedToChange.includes(domain)) errors.push(`PROTECTED_DOMAIN_UNDECLARED:${domain}`);
    const required = manifest.protectedDomains[domain]?.requiredTests ?? [];
    for (const test of required) {
      if (!input.intent.requiredTests.includes(test)) errors.push(`PROTECTED_DOMAIN_REQUIRED_TEST_MISSING:${domain}:${test}`);
    }
  }

  for (const declared of input.intent.protectedDomainsExpectedToChange) {
    if (!manifest.protectedDomains[declared]) errors.push(`UNKNOWN_PROTECTED_DOMAIN:${declared}`);
  }

  if (input.intent.wave < 6 && input.intent.changeKind !== "PRODUCTION_CORRECTNESS_REPAIR" && input.intent.changeKind !== "SECURITY_REPAIR") {
    for (const line of input.addedLines ?? []) {
      for (const token of manifest.preWave6SkillTokens) {
        if (line.includes(token)) errors.push(`AI_STORY_SKILL_FREEZE_VIOLATION:${token}`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors: [...new Set(errors)].sort(),
    classifications,
    protectedDomainsTouched: [...touched].sort(),
  };
}
