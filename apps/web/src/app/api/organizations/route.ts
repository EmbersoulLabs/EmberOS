import { getDb, schema } from "@ceo-agent/db";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError, slugify } from "@/lib/api";

export async function POST(request: Request) {
  try {
    const user = await requireAuth();
    const body = await request.json();
    const { name, slug: rawSlug } = body as { name: string; slug?: string };

    if (!name) return apiError("Name is required", "VALIDATION_ERROR");

    const slug = rawSlug ?? slugify(name);
    const db = getDb();

    const [org] = await db
      .insert(schema.organizations)
      .values({ name, slug })
      .returning();

    await db.insert(schema.organizationMembers).values({
      orgId: org!.id,
      userId: user.id,
      role: "owner",
    });

    return apiSuccess({ organization: org }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
