import type { PlanDefinition } from "@/core/entities";
import type { PlanCode } from "@/core/enums";

/** Global -- ningún método recibe tenantId, PlanDefinition no pertenece a un Tenant. */
export interface PlanRepository {
  listActive(): Promise<PlanDefinition[]>;
  getById(id: string): Promise<PlanDefinition | null>;
  getByCode(code: PlanCode): Promise<PlanDefinition | null>;
}
