import { randomUUID } from "node:crypto";
import { requireSuperAdmin } from "@/lib/require-superadmin";
import { createTrustedAdminCommandContext } from "@ceo-agent/shared/server";

/**
 * The only web transport bridge into trusted Platform Admin commands.
 * Actor identity and ACTIVE assignment always come from the server session and
 * canonical durable resolver; browser role claims are never accepted.
 */
export async function authorizePlatformAdminCommand(input: {
  commandType: string;
  reason: string;
  requestId?: string;
  idempotencyKey?: string;
}) {
  const { user, assignment } = await requireSuperAdmin();
  return createTrustedAdminCommandContext({
    actorUserId: user.id,
    activeAssignment: assignment,
    requestId: input.requestId?.trim() || randomUUID(),
    idempotencyKey: input.idempotencyKey?.trim() || randomUUID(),
    reason: input.reason,
    commandType: input.commandType,
    authenticatedAt: new Date().toISOString(),
  });
}
