import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index";

let client: ReturnType<typeof postgres> | null = null;
let db: ReturnType<typeof drizzle<typeof schema>> | null = null;

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
    client = postgres(url, {
      prepare: false,
      max: isServerless ? 1 : 10,
      connect_timeout: 15,
      idle_timeout: 20,
      max_lifetime: 60 * 30,
    });
    db = drizzle(client, { schema });
  }
  return db;
}

export async function closeDb() {
  if (client) {
    await client.end();
    client = null;
    db = null;
  }
}

export { schema };
