import { and, eq, sql } from "drizzle-orm";
import {
  AnimationPackagePayloadSchema,
  isStoryPlanningDraft,
  type AnimationPackagePayload,
} from "@ceo-agent/shared";
import { getDb, schema } from "../client";

type Db = ReturnType<typeof getDb>;
type AnimationPackageRow = typeof schema.aiStoryAnimationPackages.$inferSelect;

export type CanonicalApprovedAnimationPackage = AnimationPackageRow & {
  payload: AnimationPackagePayload & { status: "ready_for_execution" };
};

export class ApprovedAnimationPackageAuthorityError extends Error {
  readonly status = 409;

  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ApprovedAnimationPackageAuthorityError";
  }
}

export function certifyApprovedAnimationPackageRows(
  rows: readonly AnimationPackageRow[]
): CanonicalApprovedAnimationPackage | null {
  const approved: CanonicalApprovedAnimationPackage[] = [];
  for (const row of rows) {
    const parsed = isStoryPlanningDraft(row.payload)
      ? null
      : AnimationPackagePayloadSchema.safeParse(row.payload);

    if (row.status === "ready_for_execution") {
      if (!parsed || !parsed.success) {
        throw new ApprovedAnimationPackageAuthorityError(
          "APPROVED_ANIMATION_PACKAGE_PAYLOAD_INVALID",
          "Approved Animation Package payload is invalid"
        );
      }
      if (parsed.data.status !== "ready_for_execution") {
        throw new ApprovedAnimationPackageAuthorityError(
          "ANIMATION_PACKAGE_APPROVAL_STATE_MISMATCH",
          "Animation Package row and payload approval states disagree"
        );
      }
      if (!row.approvedAt || !row.approvedBy) {
        throw new ApprovedAnimationPackageAuthorityError(
          "APPROVED_ANIMATION_PACKAGE_EVIDENCE_MISSING",
          "Approved Animation Package lacks approval evidence"
        );
      }
      approved.push({
        ...row,
        payload: parsed.data as AnimationPackagePayload & {
          status: "ready_for_execution";
        },
      });
      continue;
    }

    if (parsed?.success && parsed.data.status === "ready_for_execution") {
      throw new ApprovedAnimationPackageAuthorityError(
        "ANIMATION_PACKAGE_APPROVAL_STATE_MISMATCH",
        "Animation Package row and payload approval states disagree"
      );
    }
  }

  if (approved.length > 1) {
    throw new ApprovedAnimationPackageAuthorityError(
      "CURRENT_APPROVED_ANIMATION_PACKAGE_AUTHORITY_AMBIGUOUS",
      "Approved Animation Package authority is ambiguous for this Story Version"
    );
  }
  return approved[0] ?? null;
}

/** Resolve zero or one canonical approved package for one exact Story Version. */
export async function resolveApprovedAnimationPackageForStoryVersion(
  db: Db,
  input: {
    orgId: string;
    workspaceId: string;
    campaignId: string;
    storyId: string;
    storyVersionId: string;
  }
): Promise<CanonicalApprovedAnimationPackage | null> {
  const rows = await db
    .select()
    .from(schema.aiStoryAnimationPackages)
    .where(
      and(
        eq(schema.aiStoryAnimationPackages.orgId, input.orgId),
        eq(schema.aiStoryAnimationPackages.workspaceId, input.workspaceId),
        eq(schema.aiStoryAnimationPackages.campaignId, input.campaignId),
        eq(schema.aiStoryAnimationPackages.storyId, input.storyId),
        eq(schema.aiStoryAnimationPackages.storyVersionId, input.storyVersionId)
      )
    );
  return certifyApprovedAnimationPackageRows(rows);
}

export type ApprovedAnimationPackageDuplicateGroup = {
  storyId: string;
  storyVersionId: string;
  packageIds: string[];
  approvedAt: Array<string | null>;
};

/** Read-only pre-migration audit. It never chooses or reconciles a duplicate. */
export async function auditApprovedAnimationPackageDuplicates(
  db: Db
): Promise<ApprovedAnimationPackageDuplicateGroup[]> {
  return db.execute<ApprovedAnimationPackageDuplicateGroup>(sql`
    select
      story_id as "storyId",
      story_version_id as "storyVersionId",
      array_agg(id::text order by id) as "packageIds",
      array_agg(approved_at::text order by id) as "approvedAt"
    from ai_story_animation_packages
    where status = 'ready_for_execution'
    group by story_id, story_version_id
    having count(*) > 1
    order by story_id, story_version_id
  `);
}
