import type { PlanCode, PlanStatus, SaasCapabilityKey, SaasLimitKey, TenantSubscriptionStatus } from "@/core/enums";

/**
 * Salida READ-ONLY de `ResolveTenantEntitlementsService` -- lo que el Tenant tiene DERECHO
 * COMERCIAL a usar (Plan/Subscription), nunca lo que un Employee puede hacer (`Role.permissions`)
 * ni en qué sucursal puede operar (`User.allowedBranchIds`). Ninguna de esas tres capas sustituye
 * a las demás (feature/saas-entitlement-enforcement, auditoría §0).
 *
 * `capabilities`/`limits` son SIEMPRE los valores crudos del `PlanDefinition` contratado --
 * información útil para pantallas administrativas que deben mostrar "qué contrataste" incluso
 * con la Subscription suspendida/cancelada (p.ej. "Planes y Suscripción"). `effectiveCapabilities`
 * es lo que un guard de enforcement debe usar: vacío salvo que `isEntitlementActive` sea true
 * (auditoría §1.1/§4) -- una Subscription suspendida/cancelada o un Plan archivado nunca otorgan
 * capabilities para operaciones comerciales nuevas, aunque el Plan las incluya nominalmente.
 * `limits` NO se vacía cuando la suscripción está inactiva: los límites (`maxEmployees`/
 * `maxBranches`) gobiernan Administration, que no tiene un capability general (auditoría §32) --
 * ver `ensureTenantLimit`.
 */
export interface TenantEntitlementsDto {
  tenantId: string;
  planCode: PlanCode;
  planStatus: PlanStatus;
  subscriptionStatus: TenantSubscriptionStatus;
  /** `subscriptionStatus === active && planStatus === active`. Única condición que activa capabilities. */
  isEntitlementActive: boolean;
  /** Capabilities crudas del Plan contratado -- SIEMPRE presente, informativo. */
  capabilities: SaasCapabilityKey[];
  /** `isEntitlementActive ? capabilities : []` -- lo que un guard de enforcement debe consultar. */
  effectiveCapabilities: SaasCapabilityKey[];
  /** Límites crudos del Plan. Ausente = sin límite definido para ese key (nunca "ilimitado" ni "0" implícito). */
  limits: Partial<Record<SaasLimitKey, number>>;
}
