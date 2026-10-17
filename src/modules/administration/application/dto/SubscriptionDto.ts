import type { PlanCode, SaasCapabilityKey, SaasLimitKey, TenantSubscriptionStatus } from "@/core/enums";
import type { ISODateString } from "@/core/types/common.types";
import type { SubscriptionInvoice } from "@/core/entities";

/**
 * `TenantEntitlementsDto` (salida de `ResolveTenantEntitlementsService`) se movió a
 * `src/shared/application/dto/EntitlementDto.ts` -- feature/saas-entitlement-enforcement,
 * auditoría §7: Inventory/Purchasing/Receiving/POS/Storefront/Catalog también necesitan
 * resolverla, y hacer que importen `administration` invertiría la dependencia. `administration`
 * la vuelve a importar desde ahí, igual que todos los demás módulos.
 */
export type { TenantEntitlementsDto } from "@/shared/application/dto/EntitlementDto";

export interface TenantUsageMetricDto {
  current: number;
  /** null = sin límite definido en el plan para este key -- nunca "ilimitado" fabricado. */
  limit: number | null;
}

/** Salida de GetTenantUsageService -- consumo real, tenant-scoped, nunca calculado en React. */
export interface TenantUsageDto {
  employees: TenantUsageMetricDto;
  branches: TenantUsageMetricDto;
}

export interface SubscriptionCapabilityDto {
  key: SaasCapabilityKey;
  included: boolean;
  /**
   * Solo presente cuando la capability tiene una configuración operacional independiente que
   * vale la pena mostrar (hoy: ecommerce vs EcommerceConfig.enabled). Es SOLO presentación --
   * nunca redefine si la capability está incluida en el plan.
   */
  operationalStatus?: string;
}

export interface SubscriptionUsageDto {
  key: SaasLimitKey;
  current: number;
  limit: number | null;
}

/** Un plan ofrecible por el selector -- SIEMPRE `PlanStatus.active` (plans.listActive()). */
export interface SelectablePlanDto {
  id: string;
  code: PlanCode;
  name: string;
  description?: string;
  capabilities: SaasCapabilityKey[];
}

/**
 * Read model único para la pantalla "Planes y Suscripción" (GetTenantSubscriptionDetailsService)
 * -- la UI consume ESTE contrato, nunca recalcula entitlements/usage por su cuenta.
 */
export interface TenantSubscriptionDetailsDto {
  tenantId: string;
  addonCodes: string[];
  nextRenewalAt: ISODateString;
  invoices: SubscriptionInvoice[];
  subscription: {
    status: TenantSubscriptionStatus;
    startedAt: ISODateString;
  };
  plan: {
    id: string; // NUEVO -- el picker compara contra el plan vigente
    code: PlanCode;
    name: string;
    description?: string; // NUEVO
  };
  capabilities: SubscriptionCapabilityDto[];
  usage: SubscriptionUsageDto[];
  /**
   * NUEVO -- planes activos ofrecibles. Vive en ESTE read model y no en un service aparte
   * (`docs/CONTRACTS.md`: nunca `component -> PlanRepository`): la pantalla necesita plan
   * vigente y catálogo en el MISMO snapshot, o el header y el selector pueden contradecirse.
   * Puede incluir el plan actual; el componente lo marca como "Plan actual", no lo filtra.
   */
  availablePlans: SelectablePlanDto[];
}
