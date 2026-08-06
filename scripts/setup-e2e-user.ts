/**
 * Idempotent E2E marketing test account + company/workspace bootstrap.
 *
 * Creates/reuses:
 *   - Supabase Auth user
 *   - Organization (Company)
 *   - Workspace
 *   - organization_members (Company Admin → org role "admin")
 *   - workspace_members (workspace role "admin")
 *
 * Credentials MUST come from env (never hardcoded in app source).
 *
 * Usage:
 *   E2E_USER_EMAIL=... E2E_USER_PASSWORD=... npx tsx scripts/setup-e2e-user.ts
 *
 * Also upserts E2E_* keys into .env.local and writes .env.e2e.local (gitignored).
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: resolve(root, ".env.local") });

const DEFAULTS = {
  email: "e2e.marketing@local.test",
  displayName: "E2E Marketing Tester",
  companyName: "E2E Company",
  companySlug: "e2e-company",
  workspaceName: "E2E Workspace",
  workspaceSlug: "e2e-workspace",
  /** Org "Company Admin" maps to organization_members.role = admin */
  orgRole: "admin",
  /** Workspace admin for full marketing slice permissions */
  workspaceRole: "admin",
} as const;

function upsertEnvFile(filePath: string, updates: Record<string, string>): void {
  const lines = existsSync(filePath) ? readFileSync(filePath, "utf8").split(/\r?\n/) : [];
  const keys = new Set(Object.keys(updates));
  const next: string[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
    if (match && keys.has(match[1]!)) {
      if (!seen.has(match[1]!)) {
        next.push(`${match[1]}=${updates[match[1]!]}`);
        seen.add(match[1]!);
      }
      continue;
    }
    next.push(line);
  }

  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) next.push(`${key}=${value}`);
  }

  let body = next.join("\n");
  if (!body.endsWith("\n")) body += "\n";
  writeFileSync(filePath, body, "utf8");
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const dbUrl = process.env.DATABASE_URL?.trim();
  if (!url || !key || !dbUrl) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and DATABASE_URL required");
  }

  const email = process.env.E2E_USER_EMAIL?.trim() || DEFAULTS.email;
  const password = process.env.E2E_USER_PASSWORD?.trim();
  if (!password) {
    throw new Error(
      "E2E_USER_PASSWORD is required (do not hardcode). Pass via env or set in .env.local first."
    );
  }
  const displayName = process.env.E2E_DISPLAY_NAME?.trim() || DEFAULTS.displayName;
  const companyName = process.env.E2E_COMPANY_NAME?.trim() || DEFAULTS.companyName;
  const companySlug = process.env.E2E_COMPANY_SLUG?.trim() || DEFAULTS.companySlug;
  const workspaceName = process.env.E2E_WORKSPACE_NAME?.trim() || DEFAULTS.workspaceName;
  const workspaceSlug = process.env.E2E_WORKSPACE_SLUG?.trim() || DEFAULTS.workspaceSlug;

  const admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // --- Auth user (idempotent) ---
  let userId: string;
  let authAction: "created" | "reused";
  const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listed.error) throw listed.error;
  const existing = listed.data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());

  if (existing) {
    userId = existing.id;
    authAction = "reused";
    const updated = await admin.auth.admin.updateUserById(userId, {
      password,
      email_confirm: true,
      user_metadata: {
        ...(existing.user_metadata ?? {}),
        full_name: displayName,
        display_name: displayName,
        name: displayName,
      },
    });
    if (updated.error) throw updated.error;
  } else {
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: displayName,
        display_name: displayName,
        name: displayName,
      },
    });
    if (created.error) throw created.error;
    userId = created.data.user.id;
    authAction = "created";
  }

  const sql = postgres(dbUrl, { max: 1, prepare: false });
  try {
    // --- Company / organization ---
    let [org] = await sql`
      SELECT id, name, slug FROM organizations WHERE slug = ${companySlug} LIMIT 1
    `;
    if (!org) {
      [org] = await sql`
        INSERT INTO organizations (name, slug, plan, settings)
        VALUES (
          ${companyName},
          ${companySlug},
          ${"free"},
          ${JSON.stringify({ e2e: true, status: "active" })}::jsonb
        )
        RETURNING id, name, slug
      `;
    } else if (org.name !== companyName) {
      await sql`UPDATE organizations SET name = ${companyName} WHERE id = ${org.id}`;
      org = { ...org, name: companyName };
    }

    // --- Workspace ---
    let [workspace] = await sql`
      SELECT id, name, slug, org_id, settings
      FROM workspaces
      WHERE org_id = ${org.id} AND slug = ${workspaceSlug}
      LIMIT 1
    `;
    const wsSettings = {
      e2e: true,
      status: "active",
      skipClientReview: true,
      reviewMode: "internal_only",
    };
    if (!workspace) {
      [workspace] = await sql`
        INSERT INTO workspaces (org_id, name, slug, settings)
        VALUES (
          ${org.id},
          ${workspaceName},
          ${workspaceSlug},
          ${JSON.stringify(wsSettings)}::jsonb
        )
        RETURNING id, name, slug, org_id, settings
      `;
    } else {
      const prev =
        typeof workspace.settings === "string"
          ? JSON.parse(workspace.settings)
          : ((workspace.settings as Record<string, unknown>) ?? {});
      await sql`
        UPDATE workspaces
        SET name = ${workspaceName},
            settings = ${JSON.stringify({ ...prev, ...wsSettings })}::jsonb
        WHERE id = ${workspace.id}
      `;
      workspace = { ...workspace, name: workspaceName };
    }

    // --- Memberships ---
    await sql`
      INSERT INTO organization_members (org_id, user_id, role)
      VALUES (${org.id}, ${userId}, ${DEFAULTS.orgRole})
      ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role
    `;
    await sql`
      INSERT INTO workspace_members (org_id, workspace_id, user_id, role)
      VALUES (${org.id}, ${workspace.id}, ${userId}, ${DEFAULTS.workspaceRole})
      ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role
    `;

    // Minimal business profile so campaign wizard has a company context
    const [bp] = await sql`
      SELECT id FROM business_profiles WHERE workspace_id = ${workspace.id} LIMIT 1
    `;
    if (!bp) {
      try {
        await sql`
          INSERT INTO business_profiles (
            org_id, workspace_id, company_name, business_description
          )
          VALUES (
            ${org.id},
            ${workspace.id},
            ${companyName},
            ${"E2E test company for Marketing vertical slice acceptance."}
          )
        `;
      } catch (err) {
        console.warn(
          JSON.stringify({
            warning: "business_profiles insert skipped",
            detail: err instanceof Error ? err.message : String(err),
          })
        );
      }
    }

    const report = {
      authAction,
      email,
      displayName,
      status: "active",
      userId,
      authUserId: userId,
      companyId: org.id as string,
      companyName: org.name as string,
      companySlug: org.slug as string,
      workspaceId: workspace.id as string,
      workspaceName: workspace.name as string,
      workspaceSlug: workspace.slug as string,
      orgRole: DEFAULTS.orgRole,
      workspaceRole: DEFAULTS.workspaceRole,
    };
    console.log(JSON.stringify(report, null, 2));

    const envUpdates = {
      E2E_USER_EMAIL: email,
      E2E_USER_PASSWORD: password,
      E2E_BASE_URL: process.env.E2E_BASE_URL?.trim() || "http://127.0.0.1:3000",
      E2E_WORKSPACE_SLUG: workspaceSlug,
      E2E_COMPANY_SLUG: companySlug,
      E2E_DISPLAY_NAME: displayName,
    };
    upsertEnvFile(resolve(root, ".env.local"), envUpdates);
    writeFileSync(
      resolve(root, ".env.e2e.local"),
      Object.entries(envUpdates)
        .map(([k, v]) => `${k}=${v}`)
        .concat("")
        .join("\n"),
      "utf8"
    );
    console.log(
      JSON.stringify({
        envUpdated: [".env.local", ".env.e2e.local"],
        keys: Object.keys(envUpdates),
      })
    );
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
