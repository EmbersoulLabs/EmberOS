import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index";

let client: ReturnType<typeof postgres> | null = null;
let db: ReturnType<typeof drizzle<typeof schema>> | null = null;

type Db = ReturnType<typeof drizzle<typeof schema>>;
type PostgresClient = ReturnType<typeof postgres>;
type ClientState = {
  client: PostgresClient;
  activeOperations: number;
  retired: boolean;
  closeStarted: boolean;
};

const clientStateByDb = new WeakMap<Db, ClientState>();
let currentClientState: ClientState | null = null;

export const SERVERLESS_DB_OPERATION_TIMEOUT_MS = 12_000;
export const SERVERLESS_DB_MAX_CONNECTIONS = 3;

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
    // The AI Story review surface starts three protected read chains together.
    // Keep a small, fixed serverless pool so one slow query cannot force the other
    // two into postgres-js's unbounded acquisition queue. Supavisor remains the
    // transaction-mode pooling authority. Long-lived Workers retain their existing
    // limit for concurrent FFmpeg jobs hitting the DB.
    const isServerless = process.env.VERCEL === "1";
    client = createPostgresClient(
      url,
      isServerless ? SERVERLESS_DB_MAX_CONNECTIONS : 10,
      15
    );
    db = drizzle(client, { schema });
    currentClientState = {
      client,
      activeOperations: 0,
      retired: false,
      closeStarted: false,
    };
    clientStateByDb.set(db, currentClientState);
  }
  return db;
}

function closeRetiredClientWhenIdle(state: ClientState) {
  if (!state.retired || state.activeOperations > 0 || state.closeStarted) return;
  state.closeStarted = true;
  void state.client.end({ timeout: 0 }).catch(() => undefined);
}

function retireDbClient(database: Db) {
  const state = clientStateByDb.get(database);
  if (!state) return;

  state.retired = true;
  if (db === database) {
    client = null;
    db = null;
    currentClientState = null;
  }
  closeRetiredClientWhenIdle(state);
}

/**
 * Bound one complete database dependency chain, including postgres-js pool
 * acquisition. postgres-js bounds new connections but does not time out a
 * query waiting in its pool queue. On deadline, retire the shared client so
 * later requests receive a fresh pool. The retired pool is closed only after
 * every operation already using it settles; immediately destroying a global
 * client would abort unrelated protected reads that are still in flight.
 */
export async function withDbDeadline<T>(
  database: Db,
  operation: (database: Db) => Promise<T>,
  timeoutMs = SERVERLESS_DB_OPERATION_TIMEOUT_MS
): Promise<T> {
  const state = clientStateByDb.get(database);
  if (state) state.activeOperations += 1;

  const runningOperation = Promise.resolve().then(() => operation(database));
  if (state) {
    void runningOperation.then(
      () => {
        state.activeOperations -= 1;
        closeRetiredClientWhenIdle(state);
      },
      () => {
        state.activeOperations -= 1;
        closeRetiredClientWhenIdle(state);
      }
    );
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new DatabaseDependencyTimeoutError(timeoutMs)),
      timeoutMs
    );
    timer.unref?.();
  });

  try {
    return await Promise.race([runningOperation, deadline]);
  } catch (error) {
    if (error instanceof DatabaseDependencyTimeoutError) {
      retireDbClient(database);
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
  const state = currentClientState;
  client = null;
  db = null;
  currentClientState = null;
  if (!state || state.closeStarted) return;
  state.retired = true;
  state.closeStarted = true;
  await state.client.end();
}

export { schema };
