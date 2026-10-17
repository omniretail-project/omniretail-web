import type { ISODateString } from "@/core/types/common.types";

export interface AuditLog {
  id: string;
  tenantId: string;
  actorUserId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  createdAt: ISODateString;
}
