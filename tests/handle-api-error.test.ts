import { describe, expect, it, vi } from "vitest";
import {
  OrganizationAccessError,
  TenantValidationError,
  WorkspaceAccessError,
} from "@ceo-agent/db";
import { AuthError, handleApiError } from "../apps/web/src/lib/auth";

vi.mock("@/lib/supabase/server", () => ({
  getAuthUser: vi.fn(),
}));

async function readError(response: Response) {
  return {
    status: response.status,
    body: (await response.json()) as { error: string; code: string },
  };
}

describe("handleApiError", () => {
  it("maps AuthError to 401 UNAUTHORIZED", async () => {
    const { status, body } = await readError(handleApiError(new AuthError()));
    expect(status).toBe(401);
    expect(body).toEqual({ error: "Unauthorized", code: "UNAUTHORIZED" });
  });

  it("maps TenantValidationError / VALIDATION_ERROR to 400", async () => {
    const { status, body } = await readError(
      handleApiError(new TenantValidationError("orgId must be a valid UUID"))
    );
    expect(status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.error).toBe("orgId must be a valid UUID");
  });

  it("maps WorkspaceAccessError FORBIDDEN to 403", async () => {
    const { status, body } = await readError(
      handleApiError(new WorkspaceAccessError("Not a member of this workspace", "FORBIDDEN"))
    );
    expect(status).toBe(403);
    expect(body.code).toBe("FORBIDDEN");
    expect(body.error).toBe("Not a member of this workspace");
  });

  it("maps OrganizationAccessError FORBIDDEN to 403", async () => {
    const { status, body } = await readError(
      handleApiError(
        new OrganizationAccessError("Not a member of this organization", "FORBIDDEN")
      )
    );
    expect(status).toBe(403);
    expect(body.code).toBe("FORBIDDEN");
  });

  it("maps allowlisted NOT_FOUND Error to 404", async () => {
    const err = new Error("Workspace not found") as Error & { code: string };
    err.code = "NOT_FOUND";
    const { status, body } = await readError(handleApiError(err));
    expect(status).toBe(404);
    expect(body).toEqual({ error: "Workspace not found", code: "NOT_FOUND" });
  });

  it("maps allowlisted VERSION_CONFLICT Error to 409", async () => {
    const err = new Error("Business profile version conflict") as Error & { code: string };
    err.code = "VERSION_CONFLICT";
    const { status, body } = await readError(handleApiError(err));
    expect(status).toBe(409);
    expect(body.code).toBe("VERSION_CONFLICT");
    expect(body.error).toBe("Business profile version conflict");
  });

  it("returns generic 500 for a normal unexpected Error", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { status, body } = await readError(handleApiError(new Error("secret stack detail")));
    expect(status).toBe(500);
    expect(body).toEqual({
      error: "Unexpected server error.",
      code: "INTERNAL_ERROR",
    });
    expect(JSON.stringify(body)).not.toContain("secret stack detail");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("returns generic 500 for database-like Postgres errors and does not leak fields", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const pgError = Object.assign(new Error("duplicate key value violates unique constraint"), {
      code: "23505",
      detail: 'Key (workspace_id)=(abc) already exists.',
      constraint: "business_profiles_workspace_id_unique",
      schema: "public",
      table: "business_profiles",
      column: "workspace_id",
      hint: "Check the unique constraint",
    });

    const { status, body } = await readError(handleApiError(pgError));
    expect(status).toBe(500);
    expect(body).toEqual({
      error: "Unexpected server error.",
      code: "INTERNAL_ERROR",
    });

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("23505");
    expect(serialized).not.toContain("duplicate key");
    expect(serialized).not.toContain("already exists");
    expect(serialized).not.toContain("business_profiles");
    expect(serialized).not.toContain("workspace_id");
    expect(serialized).not.toContain("constraint");
    expect(serialized).not.toContain("hint");
    spy.mockRestore();
  });

  it("returns generic 500 for arbitrary { code, message } objects", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { status, body } = await readError(
      handleApiError({
        code: "SOME_UNKNOWN_CODE",
        message: "internal implementation detail",
      })
    );
    expect(status).toBe(500);
    expect(body).toEqual({
      error: "Unexpected server error.",
      code: "INTERNAL_ERROR",
    });
    expect(JSON.stringify(body)).not.toContain("SOME_UNKNOWN_CODE");
    expect(JSON.stringify(body)).not.toContain("internal implementation detail");
    spy.mockRestore();
  });

  it("does not treat plain allowlist-shaped objects as app errors", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { status, body } = await readError(
      handleApiError({
        code: "VALIDATION_ERROR",
        message: "forged client message with SELECT * FROM secrets",
      })
    );
    expect(status).toBe(500);
    expect(body.error).toBe("Unexpected server error.");
    expect(JSON.stringify(body)).not.toContain("SELECT");
    spy.mockRestore();
  });
});
