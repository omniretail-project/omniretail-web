import type { TenantSubscriptionStatus } from "@/core/enums";
import type { ISODateString } from "@/core/types/common.types";

/**
 * Tenant-scoped -- vincula un Tenant a un PlanDefinition. `addonCodes` selecciona los
 * complementos contratados; ausencia en datos legados equivale a ninguno. `status` es la
 * foundation mínima -- ver
 * SaasSubscriptionStatus: `suspended`/`cancelled` solo se INFORMAN acá, el enforcement (bloquear
 * navegación/login) es un PR posterior.
 */
export interface TenantSubscription {
  id: string;
  tenantId: string;
  planId: string;
  status: TenantSubscriptionStatus;
  startedAt: ISODateString;
  addonCodes?: string[];
  createdAt: ISODateString;
  updatedAt: ISODateString;
}
