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

export async function downloadStorageFile(storagePath: string, localPath: string): Promise<void> {
  await withNetworkRetry(`download ${storagePath}`, async () => {
    const supabase = getAdminClient();
    const bucket = getBucket();
    const { data, error } = await supabase.storage.from(bucket).download(storagePath);
    if (error || !data) {
      throw new Error(
        `Failed to download asset: ${storagePath}${error?.message ? ` — ${error.message}` : ""}`
      );
    }
    await writeFile(localPath, Buffer.from(await data.arrayBuffer()));
  });
}

export async function uploadStorageFile(
  storagePath: string,
  localPath: string,
  contentType: string
): Promise<void> {
  await withNetworkRetry(`upload ${storagePath}`, async () => {
    const supabase = getAdminClient();
    const bucket = getBucket();
    const fileBuffer = await readFile(localPath);
    const { error } = await supabase.storage.from(bucket).upload(storagePath, fileBuffer, {
      upsert: true,
      contentType,
    });
    if (error) {
      throw new Error(`Upload failed: ${error.message}`);
    }
  });
}

export function publicStorageUrl(storagePath: string): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const bucket = getBucket();
  if (!url) throw new Error("Supabase storage not configured");
  return `${url}/storage/v1/object/public/${bucket}/${storagePath}`;
}
