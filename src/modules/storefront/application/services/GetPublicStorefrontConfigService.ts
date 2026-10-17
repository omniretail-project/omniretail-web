import { BranchType } from "@/core/enums";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { PublicStorefrontConfigDto } from "@/modules/storefront/application/dto/PublicStorefrontConfigDto";
import { ResolvePublicStorefrontContextService } from "@/modules/storefront/application/services/ResolvePublicStorefrontContextService";
import { SaasCapabilityKey } from "@/core/enums";
import { ResolveTenantEntitlementsService } from "@/shared/application/services/ResolveTenantEntitlementsService";
import { SaasEntitlementError, hasTenantCapability } from "@/shared/application/services/entitlementGuards";

type PublicConfigRepositories = Pick<
  RepositoryRegistry,
  "tenants" | "businessConfig" | "branches" | "plans" | "tenantSubscriptions"
>;

export class GetPublicStorefrontConfigService {
  private readonly contextService: ResolvePublicStorefrontContextService;

  constructor(private readonly repositories: PublicConfigRepositories) {
    this.contextService = new ResolvePublicStorefrontContextService(repositories);
  }

  async execute(tenantSlug: string): Promise<PublicStorefrontConfigDto> {
    const { tenantId, ecommerceConfig } = await this.contextService.execute({
      tenantSlug,
      allowDisabled: true,
    });
    const branches = await this.repositories.branches.getActiveByTenantAndType(
      tenantId,
      BranchType.store,
    );
    // El read model publico puede mostrar "tienda no disponible" sin perder el tenantId
    // que necesitan las rutas historicas de tracking. Las operaciones comerciales siguen
    // revalidando el entitlement estricto en sus propios Application Services.
    let commerciallyEnabled = false;
    try {
      const entitlements = await new ResolveTenantEntitlementsService(this.repositories).execute(tenantId);
      commerciallyEnabled = hasTenantCapability(entitlements, SaasCapabilityKey.ecommerce);
    } catch (error) {
      if (!(error instanceof SaasEntitlementError)) throw error;
    }

    const heroBanner = await this.repositories.businessConfig.getHeroBanner(tenantId);

    return {
      storeName: ecommerceConfig.storeName,
      storeEnabled: ecommerceConfig.enabled && commerciallyEnabled,
      accountRequired: ecommerceConfig.requireAccountForCheckout,
      guestTrackingEnabled: ecommerceConfig.guestTrackingEnabled,
      contactPhone: ecommerceConfig.contactPhone,
      contactEmail: ecommerceConfig.contactEmail,
      logoImageSource: ecommerceConfig.logo,
      branches: branches.map(({ id, name, address }) => ({ id, name, address })),
      heroBanner: {
        slides: (heroBanner?.slides ?? [])
          .filter((slide) => slide.title.trim().length > 0)
          .map((slide) => ({
            title: slide.title,
            description: slide.description,
            imageSource: slide.image,
          })),
      },
    };
  }
}
