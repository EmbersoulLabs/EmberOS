/**
 * Sprint 4 Phase B2 — Append-only Admin Audit Event persistence.
 */
import { and, desc, eq } from "drizzle-orm";
import {
  parseAdminAuditEvent,
  type AdminAuditEvent,
} from "@ceo-agent/shared";
import { getDb, schema } from "../client";
import { canonicalPersistenceHash } from "./ai-story-scene-execution-persistence";
import type { AcceptOrConvergeResult } from "./platform-admin";

type Db = ReturnType<typeof getDb>;

export type AdminAuditPersistenceErrorCode =
  | "ADMIN_AUDIT_IDENTITY_CONFLICT"
  | "ADMIN_AUDIT_NOT_FOUND";

export class AdminAuditPersistenceError extends Error {
  readonly status: number;

  constructor(
    readonly code: AdminAuditPersistenceErrorCode,
    message: string
  ) {
    super(message);
    this.name = "AdminAuditPersistenceError";
    this.status = code === "ADMIN_AUDIT_NOT_FOUND" ? 404 : 409;
  }
}

export interface AdminAuditRepository {
  getByAdminAuditEventId(
    adminAuditEventId: string
  ): Promise<AdminAuditEvent | null>;
  listByCommandId(commandId: string): Promise<readonly AdminAuditEvent[]>;
  listByActorUserId(
    actorUserId: string,
    limit?: number
  ): Promise<readonly AdminAuditEvent[]>;
  acceptOrConverge(
    event: AdminAuditEvent
  ): Promise<AcceptOrConvergeResult<AdminAuditEvent>>;
}

function toEvent(
  row: typeof schema.adminAuditEvents.$inferSelect
): AdminAuditEvent {
  return parseAdminAuditEvent(row.event);
}

function equivalencePayload(event: AdminAuditEvent): unknown {
  return {
    adminAuditEventId: event.adminAuditEventId,
    commandId: event.commandId,
    eventType: event.eventType,
    commandStatus: event.commandStatus,
    actorUserId: event.actorUserId,
    platformAdminAssignmentId: event.platformAdminAssignmentId,
    platformRole: event.platformRole,
    action: event.action,
    targetType: event.targetType,
    targetId: event.targetId,
    orgId: event.orgId,
    workspaceId: event.workspaceId,
    reason: event.reason,
    beforeReference: event.beforeReference,
    afterReference: event.afterReference,
    requestId: event.requestId,
    idempotencyKey: event.idempotencyKey,
    payloadDigest: event.payloadDigest,
    createdAt: event.createdAt,
    integrityHash: event.integrityHash,
  };
}

function assertEquivalent(
  existing: AdminAuditEvent,
  requested: AdminAuditEvent
): void {
  if (
    existing.adminAuditEventId !== requested.adminAuditEventId ||
    existing.integrityHash !== requested.integrityHash ||
    canonicalPersistenceHash(equivalencePayload(existing)) !==
      canonicalPersistenceHash(equivalencePayload(requested))
  ) {
    throw new AdminAuditPersistenceError(
      "ADMIN_AUDIT_IDENTITY_CONFLICT",
      "Conflicting Admin Audit Event identity replay rejected"
    );
  }
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (typeof current === "object" && current !== null) {
      const code = (current as { code?: unknown }).code;
      if (code === "23505") return true;
      current =
        (current as { cause?: unknown }).cause ??
        (current as { originalError?: unknown }).originalError;
      continue;
    }
    break;
  }
  return false;
}

export class AdminAuditRepositoryImpl implements AdminAuditRepository {
  constructor(private readonly db: Db = getDb()) {}

  async getByAdminAuditEventId(
    adminAuditEventId: string
  ): Promise<AdminAuditEvent | null> {
    const rows = await this.db
      .select()
      .from(schema.adminAuditEvents)
      .where(eq(schema.adminAuditEvents.adminAuditEventId, adminAuditEventId))
      .limit(1);
    return rows[0] ? toEvent(rows[0]) : null;
  }

  async listByCommandId(
    commandId: string
  ): Promise<readonly AdminAuditEvent[]> {
    const rows = await this.db
      .select()
      .from(schema.adminAuditEvents)
      .where(eq(schema.adminAuditEvents.commandId, commandId))
      .orderBy(desc(schema.adminAuditEvents.createdAt));
    return rows.map(toEvent);
  }

  async listByActorUserId(
    actorUserId: string,
    limit = 100
  ): Promise<readonly AdminAuditEvent[]> {
    const rows = await this.db
      .select()
      .from(schema.adminAuditEvents)
      .where(eq(schema.adminAuditEvents.actorUserId, actorUserId))
      .orderBy(desc(schema.adminAuditEvents.createdAt))
      .limit(limit);
    return rows.map(toEvent);
  }

  async acceptOrConverge(
    event: AdminAuditEvent
  ): Promise<AcceptOrConvergeResult<AdminAuditEvent>> {
    const existing = await this.getByAdminAuditEventId(event.adminAuditEventId);
    if (existing) {
      assertEquivalent(existing, event);
      return { value: existing, replayed: true };
    }

    const byCommandEvent = await this.db
      .select()
      .from(schema.adminAuditEvents)
      .where(
        and(
          eq(schema.adminAuditEvents.commandId, event.commandId),
          eq(schema.adminAuditEvents.eventType, event.eventType)
        )
      )
      .limit(1);
    if (byCommandEvent[0]) {
      const parsed = toEvent(byCommandEvent[0]);
      assertEquivalent(parsed, event);
      return { value: parsed, replayed: true };
    }

    try {
      await this.db.insert(schema.adminAuditEvents).values({
        adminAuditEventId: event.adminAuditEventId,
        commandId: event.commandId,
        eventType: event.eventType,
        commandStatus: event.commandStatus,
        actorUserId: event.actorUserId,
        platformAdminAssignmentId: event.platformAdminAssignmentId,
        platformRole: event.platformRole,
        action: event.action,
        targetType: event.targetType,
        targetId: event.targetId,
        orgId: event.orgId,
        workspaceId: event.workspaceId,
        reason: event.reason,
        beforeReference: event.beforeReference,
        afterReference: event.afterReference,
        requestId: event.requestId,
        idempotencyKey: event.idempotencyKey,
        payloadDigest: event.payloadDigest,
        createdAt: new Date(event.createdAt),
        integrityHash: event.integrityHash,
        contractVersion: event.contractVersion,
        event,
      });
      return { value: event, replayed: false };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced =
        (await this.getByAdminAuditEventId(event.adminAuditEventId)) ??
        (
          await this.db
            .select()
            .from(schema.adminAuditEvents)
            .where(
              and(
                eq(schema.adminAuditEvents.commandId, event.commandId),
                eq(schema.adminAuditEvents.eventType, event.eventType)
              )
            )
            .limit(1)
        )[0];
      if (!raced) {
        throw new AdminAuditPersistenceError(
          "ADMIN_AUDIT_IDENTITY_CONFLICT",
          "Admin Audit unique conflict without readable row"
        );
      }
      const parsed = "event" in raced ? toEvent(raced) : raced;
      assertEquivalent(parsed, event);
      return { value: parsed, replayed: true };
    }
  }
}
