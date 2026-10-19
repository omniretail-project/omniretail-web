import type { PlanCode, SaasCapabilityKey, SaasLimitKey, TenantSubscriptionStatus } from "@/core/enums";
import type { ISODateString } from "@/core/types/common.types";

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

/**
 * Read model único para la pantalla "Planes y Suscripción" (GetTenantSubscriptionDetailsService)
 * -- la UI consume ESTE contrato, nunca recalcula entitlements/usage por su cuenta.
 */
export interface TenantSubscriptionDetailsDto {
  tenantId: string;
  addonCodes: string[];
  subscription: {
    status: TenantSubscriptionStatus;
    startedAt: ISODateString;
  };
  plan: {
    id: string;
    code: PlanCode;
    name: string;
    description?: string;
  };
  capabilities: SubscriptionCapabilityDto[];
  usage: SubscriptionUsageDto[];
}
