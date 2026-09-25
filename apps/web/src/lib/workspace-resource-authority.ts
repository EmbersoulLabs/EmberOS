import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";

export const WORKSPACE_SLUG_HEADER = "x-emberos-workspace-slug";

export class WorkspaceResourceMismatchError extends Error {
  readonly code = "NOT_FOUND";

  constructor() {
    super("Workspace resource not found");
    this.name = "WorkspaceResourceMismatchError";
  }
}

export function assertWorkspaceResourceMatch(
  selectedWorkspaceId: string,
  resourceWorkspaceId: string
): void {
  if (selectedWorkspaceId !== resourceWorkspaceId) {
    throw new WorkspaceResourceMismatchError();
  }
}

/** Resolve the URL workspace through the authenticated user's memberships, then bind it to the resource. */
export async function requireWorkspaceResourceAuthority(input: {
  request: Request;
  userId: string;
  resourceWorkspaceId: string;
}): Promise<{ id: string; slug: string }> {
  const explicitSlug = input.request.headers.get(WORKSPACE_SLUG_HEADER)?.trim();
  const referrer = input.request.headers.get("referer");
  let referrerSlug: string | undefined;
  if (referrer) {
    try {
      const match = new URL(referrer).pathname.match(/^\/w\/([^/]+)/);
      referrerSlug = match?.[1] ? decodeURIComponent(match[1]) : undefined;
    } catch {
      referrerSlug = undefined;
    }
  }
  const slug = explicitSlug || referrerSlug;
  if (!slug) throw new WorkspaceResourceMismatchError();

  const db = getDb();
  const matches = await db
    .select({ id: schema.workspaces.id, slug: schema.workspaces.slug })
    .from(schema.workspaceMembers)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.workspaceMembers.workspaceId))
    .where(
      and(
        eq(schema.workspaceMembers.userId, input.userId),
        eq(schema.workspaces.slug, slug)
      )
    )
    .limit(2);

  // Duplicate slugs across organizations are ambiguous and therefore fail closed.
  if (matches.length !== 1) throw new WorkspaceResourceMismatchError();
  assertWorkspaceResourceMatch(matches[0]!.id, input.resourceWorkspaceId);
  return matches[0]!;
}

/** Browser helper: bind resource API requests to the /w/[slug] route currently displayed. */
export function workspaceResourceFetch(input: RequestInfo | URL, init?: RequestInit) {
  const match = typeof window === "undefined" ? null : window.location.pathname.match(/^\/w\/([^/]+)/);
  if (!match?.[1]) throw new WorkspaceResourceMismatchError();
  const headers = new Headers(init?.headers);
  headers.set(WORKSPACE_SLUG_HEADER, decodeURIComponent(match[1]));
  return fetch(input, { ...init, headers });
}
