import type { Db } from "../db/client";
import { auditLogs } from "../db/schema";

export interface AuditEntry {
  actor: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  companyId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  details?: unknown;
}

/** Append-only audit trail. Pass a transaction so the audit row commits with the change. */
export async function audit(db: Db, e: AuditEntry): Promise<void> {
  await db.insert(auditLogs).values({
    actor: e.actor,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId ?? null,
    companyId: e.companyId ?? null,
    oldValue: (e.oldValue ?? null) as never,
    newValue: (e.newValue ?? null) as never,
    details: (e.details ?? null) as never,
  });
}
