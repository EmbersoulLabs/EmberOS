/** Supabase role/function prerequisites for the isolated CI PostgreSQL database only. */
import { createIntegrationSql } from "../tests/helpers/db-integration";

const sql = createIntegrationSql();
try {
  await sql.unsafe(`
    DO $$ BEGIN
      CREATE ROLE authenticated NOLOGIN;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
    $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  `);
  console.log("Isolated PostgreSQL Supabase auth prerequisites installed.");
} finally {
  await sql.end();
}
