import type { AuditLog } from "@/core/entities";
export interface AuditLogRepository {
  getByTenant(tenantId: string): Promise<AuditLog[]>;
  append(input: Omit<AuditLog, "id" | "createdAt">): Promise<AuditLog>;
}
