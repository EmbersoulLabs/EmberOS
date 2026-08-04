/**
 * Ensure an authenticated client_viewer belongs to the E2E workspace.
 * Prints JSON: { email, userId, workspaceId, orgId, role }
 * Writes E2E_VIEWER_EMAIL / E2E_VIEWER_PASSWORD into .env.e2e.local when creating credentials.
 *
 * Env:
 *   E2E_VIEWER_EMAIL (default: e2e.viewer@local.test)
 *   E2E_VIEWER_PASSWORD (required unless already in .env.e2e.local / .env.local)
 *   E2E_WORKSPACE_SLUG / E2E_COMPANY_SLUG
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL
 */
import { config } from "dotenv";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

config({ path: resolve(".env.e2e.local") });
config({ path: resolve(".env.local") });
config({ path: resolve("apps/worker/.env") });

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
    throw new Error("NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL required");
  }

  const email =
    process.env.E2E_VIEWER_EMAIL?.trim() || "e2e.viewer@local.test";
  const password =
    process.env.E2E_VIEWER_PASSWORD?.trim() ||
    process.env.E2E_USER_PASSWORD?.trim();
  if (!password) {
    throw new Error(
      "E2E_VIEWER_PASSWORD (or E2E_USER_PASSWORD fallback) is required — do not hardcode"
    );
  }
  const workspaceSlug = process.env.E2E_WORKSPACE_SLUG?.trim() || "e2e-workspace";
  const companySlug = process.env.E2E_COMPANY_SLUG?.trim() || "e2e-company";

  const admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listed.error) throw listed.error;
  const existing = listed.data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());

  let userId: string;
  if (existing) {
    userId = existing.id;
    const updated = await admin.auth.admin.updateUserById(userId, {
      password,
      email_confirm: true,
      user_metadata: {
        ...(existing.user_metadata ?? {}),
        full_name: "E2E Client Viewer",
        display_name: "E2E Client Viewer",
      },
    });
    if (updated.error) throw updated.error;
  } else {
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: "E2E Client Viewer",
        display_name: "E2E Client Viewer",
      },
    });
    if (created.error) throw created.error;
    userId = created.data.user.id;
  }

  const sql = postgres(dbUrl, { max: 1, prepare: false });
  try {
    const [org] = await sql<{ id: string }[]>`
      SELECT id FROM organizations WHERE slug = ${companySlug} LIMIT 1
    `;
    if (!org) throw new Error(`Organization ${companySlug} not found — run setup-e2e-user.ts first`);

    const [workspace] = await sql<{ id: string; org_id: string }[]>`
      SELECT id, org_id FROM workspaces
      WHERE org_id = ${org.id} AND slug = ${workspaceSlug}
      LIMIT 1
    `;
    if (!workspace) {
      throw new Error(`Workspace ${workspaceSlug} not found — run setup-e2e-user.ts first`);
    }

    await sql`
      INSERT INTO organization_members (org_id, user_id, role)
      VALUES (${org.id}, ${userId}, ${"member"})
      ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role
    `;
    await sql`
      INSERT INTO workspace_members (org_id, workspace_id, user_id, role)
      VALUES (${org.id}, ${workspace.id}, ${userId}, ${"client_viewer"})
      ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = ${"client_viewer"}
    `;

    upsertEnvFile(resolve(".env.e2e.local"), {
      E2E_VIEWER_EMAIL: email,
      E2E_VIEWER_PASSWORD: password,
    });

    process.stdout.write(
      JSON.stringify({
        email,
        userId,
        workspaceId: workspace.id,
        orgId: workspace.org_id,
        role: "client_viewer",
      }) + "\n"
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
