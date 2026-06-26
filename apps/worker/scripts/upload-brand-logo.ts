/**
 * Upload EmberSoul brand logo to Supabase Storage and set workspace brandProfile.logoUrl.
 *
 * Usage:
 *   pnpm upload:brand-logo
 *   pnpm upload:brand-logo -- --workspace-id <uuid>
 *   pnpm upload:brand-logo -- --logo path/to/logo.png
 */
import { config } from "dotenv";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";
import { STORAGE_PATHS, type BrandProfile } from "@ceo-agent/shared";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../../..");

config({ path: resolve(__dirname, "../.env") });
config({ path: resolve(root, ".env.local") });
config({ path: resolve(root, ".env") });

function parseArgs(argv: string[]) {
  let workspaceId: string | undefined;
  let logoPath: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--workspace-id" && argv[i + 1]) workspaceId = argv[++i];
    if (argv[i] === "--logo" && argv[i + 1]) logoPath = argv[++i];
  }
  return { workspaceId, logoPath };
}

async function uploadToStorage(storagePath: string, fileBuffer: Buffer, contentType: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "campaign-assets";
  if (!url || !serviceKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required");
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await supabase.storage.from(bucket).upload(storagePath, fileBuffer, {
    upsert: true,
    contentType,
  });
  if (error) throw new Error(`Upload failed: ${error.message}`);

  return { bucket, publicUrl: `${url}/storage/v1/object/public/${bucket}/${storagePath}` };
}

async function main() {
  const { workspaceId: targetId, logoPath: customLogo } = parseArgs(process.argv.slice(2));

  const defaultLogo = join(root, "apps/worker/assets/brand/logo-horizontal.png");
  const logoPath = customLogo ? resolve(customLogo) : defaultLogo;

  if (!existsSync(logoPath)) {
    console.error(`Logo file not found: ${logoPath}`);
    process.exit(1);
  }

  const ext = logoPath.split(".").pop()?.toLowerCase() ?? "png";
  const contentType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
  const filename = logoPath.split(/[/\\]/).pop() ?? "logo-horizontal.png";
  const fileBuffer = await readFile(logoPath);

  const db = getDb();
  const workspaces = targetId
    ? await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, targetId))
    : await db.select().from(schema.workspaces);

  if (workspaces.length === 0) {
    console.error(targetId ? `Workspace not found: ${targetId}` : "No workspaces in database");
    process.exit(1);
  }

  console.log(`Uploading logo (${(fileBuffer.length / 1024).toFixed(1)} KB) to ${workspaces.length} workspace(s)...`);

  for (const ws of workspaces) {
    const storagePath = STORAGE_PATHS.brandLogo(ws.id, filename);
    const { publicUrl } = await uploadToStorage(storagePath, fileBuffer, contentType);

    const existing = (ws.brandProfile ?? {}) as BrandProfile;
    const brandProfile: BrandProfile = {
      ...existing,
      logoUrl: storagePath,
    };

    await db
      .update(schema.workspaces)
      .set({ brandProfile })
      .where(eq(schema.workspaces.id, ws.id));

    console.log(`✓ ${ws.name} (${ws.slug})`);
    console.log(`  storage: ${storagePath}`);
    console.log(`  public:  ${publicUrl}`);
  }

  console.log("\nDone. Re-render videos to apply watermark.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
