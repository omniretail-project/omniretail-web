import type { BusinessCapabilitiesConfig } from "@/core/entities";
import { SaasCapabilityKey } from "@/core/enums";
import type { TenantEntitlementsDto } from "@/shared/application/dto/EntitlementDto";
import { hasTenantCapability } from "@/shared/application/services/entitlementGuards";

/**
 * `BusinessCapabilitiesConfig` (config operativa del Tenant) y SaaS capability (derecho
 * comercial) NO son equivalentes (feature/saas-entitlement-enforcement, auditoría §17 -- CRÍTICO).
 * Este mapa cubre EXCLUSIVAMENTE los campos reales de `BusinessCapabilitiesConfig` que tienen una
 * `SaasCapabilityKey` equivalente -- `supportsMultipleLocations`, `supportsUnitsAndPackaging`,
 * `supportsProductAttributes`, `supportsServices` y `allowedPosPaymentMethods` NO tienen
 * contraparte SaaS y quedan fuera de este mapa a propósito (no se inventa una capability nueva).
 */
export const BUSINESS_CAPABILITY_TO_SAAS_CAPABILITY = {
  supportsLots: SaasCapabilityKey.traceabilityLots,
  supportsExpiration: SaasCapabilityKey.traceabilityExpiration,
  supportsSerials: SaasCapabilityKey.traceabilitySerials,
  supportsKits: SaasCapabilityKey.catalogKits,
} as const satisfies Partial<Record<keyof BusinessCapabilitiesConfig, SaasCapabilityKey>>;

export type MappedBusinessCapabilityKey = keyof typeof BUSINESS_CAPABILITY_TO_SAAS_CAPABILITY;

/**
 * `effectiveFeatureEnabled = planHasCapability AND businessConfigSetting` (auditoría §17/§19).
 * Un downgrade de Plan NUNCA muta `BusinessCapabilitiesConfig` -- el setting persistido puede
 * seguir en `true`, pero el efecto real cae a `false` hasta que el Tenant vuelva a un Plan que lo
 * incluya (auditoría §19), momento en el que el setting previo vuelve a ser efectivo sin
 * reconfigurar nada.
 */
export function isEffectiveBusinessCapabilityEnabled(
  entitlements: TenantEntitlementsDto,
  businessConfig: Pick<BusinessCapabilitiesConfig, MappedBusinessCapabilityKey>,
  key: MappedBusinessCapabilityKey,
): boolean {
  if (!businessConfig[key]) return false;
  return hasTenantCapability(entitlements, BUSINESS_CAPABILITY_TO_SAAS_CAPABILITY[key]);
}
