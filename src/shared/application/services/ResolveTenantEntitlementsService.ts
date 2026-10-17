import { PlanStatus, TenantSubscriptionStatus } from "@/core/enums";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { TenantEntitlementsDto } from "@/shared/application/dto/EntitlementDto";
import { SaasEntitlementError } from "@/shared/application/services/entitlementGuards";
import { SUBSCRIPTION_ADDONS } from "@/core/subscription/catalog";

/**
 * Domain service reutilizable, neutral respecto de módulos (feature/saas-entitlement-
 * enforcement, auditoría §4/§7) -- vivía en `administration`, pero Inventory/Purchasing/
 * Receiving/POS/Storefront/Catalog necesitan resolver entitlements sin crear una dependencia
 * hacia atrás (`inventory -> administration`). `src/shared/application` es la única capa
 * Application neutral de la que cualquier módulo puede depender sin invertir el sentido de las
 * dependencias -- mismo criterio que `resolveCurrentSessionSnapshot` en `auth` (auth tampoco
 * depende de nadie).
 *
 * NO existe un segundo resolver paralelo: `administration` (Plan/Subscription screens,
 * `GetTenantUsageService`) importa este MISMO service desde acá.
 *
 * Deliberadamente SIN chequeo de `permissions`: no es una pantalla, es la pieza que cualquier
 * consumidor usa para resolver "qué tiene derecho a usar este Tenant" -- nunca "qué puede hacer
 * este Employee" (`Role.permissions`) ni "en qué sucursal puede operar este User"
 * (`User.allowedBranchIds`), ver docstring de `TenantEntitlementsDto`.
 *
 * Fail-closed y explícito (auditoría §1.2): sin `TenantSubscription`, o con una Subscription que
 * apunta a un `PlanDefinition` inexistente, esto LANZA `SaasEntitlementError` -- nunca asume
 * Enterprise, `plan-basic` ni ningún otro plan por default para un tenant no reconocido, y nunca
 * cae a `tenant-demo`. `tenantId` SIEMPRE debe llegar ya resuelto desde la sesión autoritativa del
 * caller (`resolveCurrentSessionSnapshot`/`resolvePurchasingContext`/etc.) -- este service nunca
 * acepta un `tenantId` como autoridad porque no tiene forma de validar de dónde vino.
 */
export class ResolveTenantEntitlementsService {
  constructor(private readonly repositories: Pick<RepositoryRegistry, "plans" | "tenantSubscriptions">) {}

  async execute(tenantId: string): Promise<TenantEntitlementsDto> {
    if (!tenantId.trim()) {
      throw new SaasEntitlementError("SUBSCRIPTION_MISSING", "No se pudo resolver el negocio activo.");
    }

    const subscription = await this.repositories.tenantSubscriptions.getByTenantId(tenantId);
    if (!subscription) {
      throw new SaasEntitlementError("SUBSCRIPTION_MISSING");
    }

    const plan = await this.repositories.plans.getById(subscription.planId);
    if (!plan) {
      throw new SaasEntitlementError("PLAN_MISSING");
    }

    const isEntitlementActive =
      subscription.status === TenantSubscriptionStatus.active && plan.status === PlanStatus.active;

    const capabilities = [...new Set([
      ...plan.capabilities,
      ...SUBSCRIPTION_ADDONS.filter((addon) => subscription.addonCodes?.includes(addon.code))
        .flatMap((addon) => [...addon.capabilities]),
    ])];

    return {
      tenantId,
      planCode: plan.code,
      planStatus: plan.status,
      subscriptionStatus: subscription.status,
      isEntitlementActive,
      capabilities,
      effectiveCapabilities: isEntitlementActive ? capabilities : [],
      limits: { ...plan.limits },
    };
  }
}
