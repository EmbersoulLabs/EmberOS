import { readFile, writeFile } from "node:fs/promises";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";

let adminClient: SupabaseClient | null = null;

function getBucket() {
  return process.env.SUPABASE_STORAGE_BUCKET ?? "campaign-assets";
}

function getAdminClient() {
  if (adminClient) return adminClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Supabase storage not configured");
  }

  adminClient = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: ws as unknown as typeof WebSocket },
  });
  return adminClient;
}

async function withNetworkRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const attempts = 3;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        const delayMs = 1000 * 2 ** i;
        console.warn(`[storage] ${label} failed (attempt ${i + 1}/${attempts}), retrying in ${delayMs}ms`);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  throw lastErr;
}

export async function downloadStorageFile(
  storagePath: string,
  localPath: string,
  options?: { readonly bucket?: string }
): Promise<void> {
  await withNetworkRetry(`download ${storagePath}`, async () => {
    const supabase = getAdminClient();
    const bucket = options?.bucket ?? getBucket();
    const { data, error } = await supabase.storage.from(bucket).download(storagePath);
    if (error || !data) {
      throw new Error(
        `Failed to download asset: ${storagePath}${error?.message ? ` — ${error.message}` : ""}`
      );
    }
    await writeFile(localPath, Buffer.from(await data.arrayBuffer()));
  });
}
/** Resolve only the exact server-derived object, with bounded legacy URL support. */
export function resolveExpectedStoragePath(
  reference: string,
  expectedStoragePath: string
): string {
  if (reference === expectedStoragePath) return expectedStoragePath;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  if (!url) throw new Error("Supabase storage not configured");
  const historicalPublicUrl = `${url}/storage/v1/object/public/${getBucket()}/${expectedStoragePath}`;
  if (reference === historicalPublicUrl) return expectedStoragePath;

  throw new Error("Artifact reference does not match server-owned storage identity");
}

export async function downloadStorageReference(
  reference: string,
  expectedStoragePath: string,
  localPath: string
): Promise<void> {
  await downloadStorageFile(resolveExpectedStoragePath(reference, expectedStoragePath), localPath);
}

export async function uploadStorageFile(
  storagePath: string,
  localPath: string,
  contentType: string,
  options?: { upsert?: boolean }
): Promise<void> {
  const upsert = options?.upsert ?? true;
  await withNetworkRetry(`upload ${storagePath}`, async () => {
    const supabase = getAdminClient();
    const bucket = getBucket();
    const fileBuffer = await readFile(localPath);
    const { error } = await supabase.storage.from(bucket).upload(storagePath, fileBuffer, {
      upsert,
      contentType,
    });
    if (error) {
      throw new Error(`Upload failed: ${error.message}`);
    }
  });
}

/** Immutable upload — never overwrites existing objects (upsert:false). */
export async function uploadStorageFileImmutable(
  storagePath: string,
  localPath: string,
  contentType: string
): Promise<"created" | "already_exists"> {
  try {
    await uploadStorageFile(storagePath, localPath, contentType, { upsert: false });
    return "created";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/already exists|Duplicate|409|resource already/i.test(message)) {
      return "already_exists";
    }
    throw error;
  }
}
