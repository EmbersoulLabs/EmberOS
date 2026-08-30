import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index";

let client: ReturnType<typeof postgres> | null = null;
let db: ReturnType<typeof drizzle<typeof schema>> | null = null;

type Db = ReturnType<typeof drizzle<typeof schema>>;

function createPostgresClient(url: string, max: number, connectTimeout: number) {
  return postgres(url, {
    prepare: false,
    max,
    connect_timeout: connectTimeout,
    idle_timeout: 20,
    max_lifetime: 60 * 30,
  });
}

export function getDb() {
  if (!db) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL is not set");
    }
    // Vercel serverless: cap at 1 connection per function instance so pgbouncer
    // transaction-mode pooling isn't overwhelmed. Long-lived Worker processes use
    // the default (10) to support concurrent FFmpeg jobs hitting the DB.
    const isServerless = process.env.VERCEL === "1";
    client = createPostgresClient(url, isServerless ? 1 : 10, 15);
    db = drizzle(client, { schema });
  }
  return db;
}

/**
 * Run a bounded recovery write outside the process-global pool.
 *
 * This is intentionally reserved for failure classification after a primary
 * operation may have stalled while holding the global serverless connection.
 */
export async function withFreshDbContext<T>(
  operation: (freshDb: Db) => Promise<T>
): Promise<T> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const freshClient = createPostgresClient(url, 1, 3);
  const freshDb = drizzle(freshClient, { schema });
  try {
    await freshClient.unsafe("set statement_timeout = '3s'");
    await freshClient.unsafe("set lock_timeout = '2s'");
    return await operation(freshDb);
  } finally {
    await freshClient.end({ timeout: 1 });
  }
}

export async function closeDb() {
  if (client) {
    await client.end();
    client = null;
    db = null;
  }
}

export { schema };
