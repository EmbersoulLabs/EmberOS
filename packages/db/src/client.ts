import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index";

let client: ReturnType<typeof postgres> | null = null;
let db: ReturnType<typeof drizzle<typeof schema>> | null = null;

type Db = ReturnType<typeof drizzle<typeof schema>>;

const SERVERLESS_DB_OPERATION_TIMEOUT_MS = 12_000;

export class DatabaseDependencyTimeoutError extends Error {
  readonly code = "DATABASE_DEPENDENCY_TIMEOUT";

  constructor(readonly timeoutMs: number) {
    super(`Database dependency did not complete within ${timeoutMs}ms`);
    this.name = "DatabaseDependencyTimeoutError";
  }
}

function createPostgresClient(
  url: string,
  max: number,
  connectTimeout: number
) {
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

async function discardDbClient() {
  const staleClient = client;
  client = null;
  db = null;
  if (staleClient) {
    await staleClient.end({ timeout: 0 });
  }
}

/**
 * Bound one complete database dependency chain, including postgres-js pool
 * acquisition. postgres-js bounds new connections but does not time out a
 * query waiting in its pool queue. On deadline, destroy the occupied client so
 * a warm serverless instance cannot remain poisoned for later requests.
 */
export async function withDbDeadline<T>(
  database: Db,
  operation: (database: Db) => Promise<T>,
  timeoutMs = SERVERLESS_DB_OPERATION_TIMEOUT_MS
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new DatabaseDependencyTimeoutError(timeoutMs)),
      timeoutMs
    );
    timer.unref?.();
  });

  try {
    return await Promise.race([operation(database), deadline]);
  } catch (error) {
    if (error instanceof DatabaseDependencyTimeoutError) {
      await discardDbClient();
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
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
