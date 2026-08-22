import { afterEach, describe, expect, it } from "vitest";
import { assertIsolatedTestDatabase } from "./helpers/db-integration";

const originalEnvironment = process.env.EMBEROS_TEST_DB_ENVIRONMENT;
const originalIsolated = process.env.EMBEROS_TEST_DB_ISOLATED;

afterEach(() => {
  if (originalEnvironment === undefined) delete process.env.EMBEROS_TEST_DB_ENVIRONMENT;
  else process.env.EMBEROS_TEST_DB_ENVIRONMENT = originalEnvironment;
  if (originalIsolated === undefined) delete process.env.EMBEROS_TEST_DB_ISOLATED;
  else process.env.EMBEROS_TEST_DB_ISOLATED = originalIsolated;
});

describe("isolated integration database authority", () => {
  it("allows an explicitly identified local test database", () => {
    process.env.EMBEROS_TEST_DB_ENVIRONMENT = "test";
    expect(
      assertIsolatedTestDatabase("postgresql://tester:secret@127.0.0.1:5432/emberos_test")
    ).toMatchObject({ environment: "test" });
  });

  it.each(["egkgybrjmzukzmkcrpag", "voofxbuzpocyjzoxrpfi"])(
    "fails closed for forbidden project %s",
    (project) => {
      process.env.EMBEROS_TEST_DB_ENVIRONMENT = "test";
      process.env.EMBEROS_TEST_DB_ISOLATED = "1";
      expect(() =>
        assertIsolatedTestDatabase(`postgresql://tester:secret@db.${project}.supabase.co/postgres`)
      ).toThrow("TEST_DB_FORBIDDEN_AUTHORITY");
    }
  );

  it("denies a remote database whose isolation is not explicit", () => {
    process.env.EMBEROS_TEST_DB_ENVIRONMENT = "test";
    expect(() =>
      assertIsolatedTestDatabase("postgresql://tester:secret@test.example.com/emberos")
    ).toThrow("TEST_DB_ISOLATION_UNPROVEN");
  });
});
