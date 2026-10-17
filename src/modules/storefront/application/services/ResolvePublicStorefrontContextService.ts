import type { EcommerceConfig } from "@/core/entities";
import { SaasCapabilityKey, TenantStatus } from "@/core/enums";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { ensureTenantCapability } from "@/shared/application/services/entitlementGuards";
import { ResolveTenantEntitlementsService } from "@/shared/application/services/ResolveTenantEntitlementsService";

type PublicStorefrontRepositories = Pick<
  RepositoryRegistry,
  "tenants" | "businessConfig" | "plans" | "tenantSubscriptions"
>;

export interface PublicStorefrontContext {
  tenantId: string;
  ecommerceConfig: EcommerceConfig;
}

/**
 * Boundary autoritativo del tenant publico. No recibe tenantId del caller:
 * lo deriva del slug configurado y revalida tenant + EcommerceConfig.
 *
 * Feature/saas-entitlement-enforcement (auditoría §15/§31/§49): en modo estricto (default,
 * `allowDisabled` ausente/false -- el usado por el checkout y por el guard de lectura de
 * `ensurePublicStorefrontTenant`), TAMBIÉN exige Subscription active + Plan active + SaaS
 * capability `ecommerce`, además de `EcommerceConfig.enabled`. Las 4 condiciones son
 * INDEPENDIENTES entre sí (§49): cualquiera ausente bloquea. El modo `allowDisabled: true`
 * (usado por `GetPublicStorefrontConfigService`/`PublicTenantProvider` para mostrar un mensaje
 * de "tienda deshabilitada" y por el tracking histórico para validar el slug público) sigue sin
 * exigir esto -- nunca es el modo que autoriza una operación comercial nueva.
 */
export class ResolvePublicStorefrontContextService {
  constructor(private readonly repositories: PublicStorefrontRepositories) {}

  async execute({ tenantSlug, allowDisabled = false }: { tenantSlug: string; allowDisabled?: boolean }): Promise<PublicStorefrontContext> {
    const tenant = await this.repositories.tenants.getBySlug(tenantSlug);
    if (!tenant || tenant.status !== TenantStatus.active) {
      throw new Error("La tienda pública no está disponible.");
    }

    const ecommerceConfig = await this.repositories.businessConfig.getEcommerceConfig(tenant.id);
    if (
      !ecommerceConfig ||
      ecommerceConfig.tenantId !== tenant.id ||
      (!allowDisabled && !ecommerceConfig.enabled)
    ) {
      throw new Error("La tienda pública no está disponible.");
    }

    if (!allowDisabled) {
      const entitlements = await new ResolveTenantEntitlementsService(
        this.repositories as RepositoryRegistry,
      ).execute(tenant.id);
      ensureTenantCapability(entitlements, SaasCapabilityKey.ecommerce);
    }

    return { tenantId: tenant.id, ecommerceConfig };
  }
}

/**
 * Guard reutilizable para las lecturas públicas de Storefront (discovery, detalle de producto,
 * lecturas de catálogo) que hoy reciben `tenantId` como parámetro ya resuelto por el caller en vez
 * de derivarlo ellas mismas (auditoría §15) -- revalida que ESE `tenantId` sea exactamente el
 * tenant público autoritativo (modo estricto: Tenant activo + EcommerceConfig.enabled +
 * Subscription/Plan activos + capability `ecommerce`). Cierra el gap donde una llamada directa al
 * Application Service con un `tenantId` arbitrario (bypass de `PublicTenantProvider`) no
 * revalidaba nada (auditoría §30).
 */
export async function ensurePublicStorefrontTenant(
  repositories: PublicStorefrontRepositories,
  tenantSlug: string,
  tenantId: string,
): Promise<void> {
  const context = await new ResolvePublicStorefrontContextService(repositories).execute({ tenantSlug });
  if (context.tenantId !== tenantId) {
    throw new Error("La tienda pública no está disponible.");
  }
}
