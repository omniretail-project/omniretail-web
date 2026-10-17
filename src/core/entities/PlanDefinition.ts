import type { PlanCode, PlanStatus, SaasCapabilityKey, SaasLimitKey } from "@/core/enums";
import type { ISODateString } from "@/core/types/common.types";

/**
 * Global -- NO pertenece a un Tenant (a diferencia de TenantSubscription, que sí). Catálogo de
 * planes comerciales disponibles para contratar; `capabilities`/`limits` son la fuente de verdad
 * de lo que un plan otorga, nunca duplicada ni recalculada en componentes React (ver
 * ResolveTenantEntitlementsService).
 */
export interface PlanDefinition {
  id: string;
  code: PlanCode;
  name: string;
  description?: string;
  monthlyQuetzales?: number;
  status: PlanStatus;
  capabilities: SaasCapabilityKey[];
  /** Ausente = sin límite definido para ese key en este plan (nunca "ilimitado" implícito). */
  limits: Partial<Record<SaasLimitKey, number>>;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}
