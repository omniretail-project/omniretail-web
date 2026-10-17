import type { SaasCapabilityKey, SaasLimitKey } from "@/core/enums";
import { PlanStatus, TenantSubscriptionStatus } from "@/core/enums";
import type { TenantEntitlementsDto } from "@/shared/application/dto/EntitlementDto";

/**
 * Motivos machine-readable de una denegación por entitlement (feature/saas-entitlement-
 * enforcement, auditoría §5) -- nunca se reporta una restricción de Plan como "no tenés
 * permisos": ese mensaje es exclusivo de una denegación de `Role.permissions`. La UI puede leer
 * `error.code` para distinguir ambos sin parsear el texto del mensaje.
 */
export type SaasEntitlementErrorCode =
  | "CAPABILITY_REQUIRED"
  | "LIMIT_REACHED"
  | "SUBSCRIPTION_INACTIVE"
  | "PLAN_INACTIVE"
  | "SUBSCRIPTION_MISSING"
  | "PLAN_MISSING";

const DEFAULT_MESSAGES: Record<SaasEntitlementErrorCode, string> = {
  CAPABILITY_REQUIRED: "Esta función no está incluida en tu plan actual.",
  LIMIT_REACHED: "Alcanzaste el límite de tu plan actual.",
  SUBSCRIPTION_INACTIVE: "La suscripción del negocio no está activa.",
  PLAN_INACTIVE: "El plan del negocio no está activo.",
  SUBSCRIPTION_MISSING: "El negocio activo no tiene una suscripción configurada.",
  PLAN_MISSING: "El plan asociado a la suscripción del negocio ya no existe.",
};

export class SaasEntitlementError extends Error {
  readonly code: SaasEntitlementErrorCode;

  constructor(code: SaasEntitlementErrorCode, message: string = DEFAULT_MESSAGES[code]) {
    super(message);
    this.name = "SaasEntitlementError";
    this.code = code;
  }
}

/**
 * Composición obligatoria (auditoría §9): TENANT ENTITLEMENT AND ROLE PERMISSION AND BRANCH
 * ACCESS AND RESOURCE OWNERSHIP. Este guard es SOLO la primera capa -- nunca sustituye los
 * `ensureCanXxx(permissions)`/`ensureUserCanOperateBranch`/ownership checks ya existentes en cada
 * módulo; se llama ADEMÁS de ellos, nunca en su lugar.
 *
 * Chequea subscription/plan ANTES que la capability puntual para poder devolver el `code` más
 * específico (SUBSCRIPTION_INACTIVE/PLAN_INACTIVE) en vez de un CAPABILITY_REQUIRED genérico --
 * ver `TenantEntitlementsDto.effectiveCapabilities` para el atajo booleano equivalente sin el
 * detalle del motivo (usado por `EntitlementProvider.hasCapability`).
 */
export function ensureTenantCapability(
  entitlements: TenantEntitlementsDto,
  key: SaasCapabilityKey,
): void {
  if (entitlements.subscriptionStatus !== TenantSubscriptionStatus.active) {
    throw new SaasEntitlementError("SUBSCRIPTION_INACTIVE");
  }
  if (entitlements.planStatus !== PlanStatus.active) {
    throw new SaasEntitlementError("PLAN_INACTIVE");
  }
  if (!entitlements.capabilities.includes(key)) {
    throw new SaasEntitlementError("CAPABILITY_REQUIRED");
  }
}

export function hasTenantCapability(
  entitlements: TenantEntitlementsDto,
  key: SaasCapabilityKey,
): boolean {
  return entitlements.effectiveCapabilities.includes(key);
}

/**
 * `undefined` en `PlanDefinition.limits` significa "sin límite" (auditoría §1.6) -- nunca se
 * interpreta como 0. Deliberadamente NO depende de `isEntitlementActive`/subscriptionStatus:
 * Administration no tiene una capability general (auditoría §32), así que una Subscription
 * suspendida no es motivo para bloquear `CreateEmployeeService`/`CreateBranchService` -- solo el
 * límite numérico del Plan contratado importa acá. Fail-closed por Subscription/Plan
 * inexistentes ya ocurre antes, en `ResolveTenantEntitlementsService` (SUBSCRIPTION_MISSING/
 * PLAN_MISSING), porque sin esos dos no hay ningún límite que leer.
 */
export function getTenantLimit(
  entitlements: TenantEntitlementsDto,
  key: SaasLimitKey,
): number | undefined {
  return entitlements.limits[key];
}

export function ensureTenantLimit(
  entitlements: TenantEntitlementsDto,
  key: SaasLimitKey,
  currentCount: number,
): void {
  const limit = getTenantLimit(entitlements, key);
  if (limit === undefined) return;
  if (currentCount >= limit) {
    throw new SaasEntitlementError("LIMIT_REACHED");
  }
}

export function cleanEntitlementError(error: unknown, fallback: string): string {
  if (error instanceof SaasEntitlementError) return error.message;
  if (error instanceof Error) return error.message;
  return fallback;
}
