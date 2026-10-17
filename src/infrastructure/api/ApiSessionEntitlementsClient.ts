import type { PlanDefinition, TenantSubscription } from "@/core/entities";
import type {
  PlanCode,
  PlanStatus,
  SaasCapabilityKey,
  SaasLimitKey,
  TenantSubscriptionStatus,
} from "@/core/enums";
import type { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import { TtlCache } from "@/infrastructure/api/TtlCache";

/** `SessionEntitlementsResponse` del backend (`GET /auth/session/entitlements`). */
export interface ApiSessionEntitlements {
  tenantId: string;
  planCode: string;
  planStatus: string;
  subscriptionStatus: string;
  isEntitlementActive: boolean;
  /** Capacidades del plan mas las de sus complementos. */
  capabilities: string[];
  effectiveCapabilities: string[];
  limits: Record<string, number>;
}

const CACHE_TTL_MS = 15_000;
const SYNTHETIC_PLAN_PREFIX = "session-plan:";

/**
 * Lee los entitlements del negocio de la sesion para empleados SIN `admin.plans.read` (Cajero,
 * Inventario, Bodeguero...). Sin esto `/admin/subscriptions` y `/admin/plans` les dan 403 y el
 * resolver de entitlements cae al mock, que no conoce su tienda: `hasCapability` queda siempre en
 * `false` y se les bloquean acciones que el backend si permite.
 *
 * Pasa por el BFF `/api/auth/session/entitlements` porque el puente `/api/backend` bloquea
 * `auth/**`. Cache corta con deduplicacion en vuelo; los cambios de suscripcion y de sesion la
 * invalidan. 404 (sin suscripcion) se devuelve como `null`: el resolver falla cerrado.
 */
export class ApiSessionEntitlementsClient {
  private readonly cache = new TtlCache<ApiSessionEntitlements | null>(CACHE_TTL_MS);

  constructor(eventBus: DataEventBus) {
    eventBus.subscribe("tenant-subscription.changed", () => this.cache.invalidate());
    eventBus.subscribe("auth.changed", () => this.cache.invalidate());
  }

  async get(): Promise<ApiSessionEntitlements | null> {
    // Solo en el navegador: la cookie HttpOnly viaja sola en un fetch same-origin. Desde el
    // servidor la URL relativa no resuelve ni llevaria la sesion del usuario.
    if (typeof window === "undefined") {
      throw new TypeError("Los entitlements de la sesion solo se pueden leer desde el navegador.");
    }
    return this.cache.get(async () => {
      const response = await fetch("/api/auth/session/entitlements", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (response.status === 404) return null;
      if (!response.ok) {
        throw new BackendRequestError(
          "No se pudieron cargar los entitlements del negocio.",
          response.status,
        );
      }
      return (await response.json()) as ApiSessionEntitlements;
    });
  }
}

/** Id del plan sintetico: lleva el codigo para que `plans.getById` lo resuelva sin otra llamada. */
function syntheticPlanId(entitlements: ApiSessionEntitlements): string {
  return `${SYNTHETIC_PLAN_PREFIX}${entitlements.tenantId}`;
}

/**
 * Suscripcion derivada de los entitlements de la sesion. `addonCodes` queda vacio porque
 * `capabilities` ya trae las capacidades de los complementos fusionadas: asi el resolver no las
 * suma dos veces ni necesita conocer el catalogo de complementos.
 */
export function toSessionSubscription(entitlements: ApiSessionEntitlements): TenantSubscription {
  const epoch = new Date(0).toISOString();
  return {
    id: `${SYNTHETIC_PLAN_PREFIX}subscription:${entitlements.tenantId}`,
    tenantId: entitlements.tenantId,
    planId: syntheticPlanId(entitlements),
    status: entitlements.subscriptionStatus as TenantSubscriptionStatus,
    startedAt: epoch,
    addonCodes: [],
    createdAt: epoch,
    updatedAt: epoch,
  };
}

/** Plan derivado de los entitlements de la sesion (capacidades ya fusionadas con las de addons). */
export function toSessionPlan(entitlements: ApiSessionEntitlements): PlanDefinition {
  const epoch = new Date(0).toISOString();
  return {
    id: syntheticPlanId(entitlements),
    code: entitlements.planCode as PlanCode,
    name: entitlements.planCode,
    status: entitlements.planStatus as PlanStatus,
    capabilities: entitlements.capabilities as SaasCapabilityKey[],
    limits: { ...entitlements.limits } as Partial<Record<SaasLimitKey, number>>,
    createdAt: epoch,
    updatedAt: epoch,
  };
}

export function isSessionPlanId(id: string): boolean {
  return id.startsWith(SYNTHETIC_PLAN_PREFIX);
}
