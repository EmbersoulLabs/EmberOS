import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";
import { slugify } from "@/lib/api";

type Db = ReturnType<typeof getDb>;

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (typeof current !== "object" || current === null) break;
    if ((current as { code?: unknown }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export function organizationSlugCandidates(input: {
  name: string;
  requestedSlug?: string;
  userId: string;
}): readonly string[] {
  const base = slugify(input.requestedSlug?.trim() || input.name) || "organization";
  const suffix = createHash("sha256")
    .update(`organization-owner:${input.userId}`)
    .digest("hex")
    .slice(0, 10);
  return [base, `${base}-${suffix}`];
}

/** Idempotent first-Organization provisioning for a normal authenticated user. */
export async function provisionFirstOrganizationForUser(input: {
  userId: string;
  name: string;
  requestedSlug?: string;
  db?: Db;
}) {
  const db = input.db ?? getDb();
  const [existing] = await db
    .select({ organization: schema.organizations })
    .from(schema.organizationMembers)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.organizationMembers.orgId))
    .where(eq(schema.organizationMembers.userId, input.userId))
    .limit(1);
  if (existing) return { organization: existing.organization, created: false } as const;

  for (const slug of organizationSlugCandidates(input)) {
    try {
      const organization = await db.transaction(async (tx) => {
        const [created] = await tx.insert(schema.organizations)
          .values({ name: input.name, slug })
          .returning();
        if (!created) throw new Error("Organization insert returned no row");
        await tx.insert(schema.organizationMembers).values({
          orgId: created.id,
          userId: input.userId,
          role: "owner",
        });
        return created;
      });
      return { organization, created: true } as const;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }

  throw new Error("Unable to allocate deterministic unique Organization slug");
}
