import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { ProductType } from "@/core/enums";
import {
  getCanonicalKitAvailability,
  getCanonicalProductAvailability,
} from "@/core/inventory/canonicalAvailability";
import {
  getProductMediaSource,
  normalizeCatalogImageSource,
  selectPrimaryProductMedia,
} from "@/core/media/catalogImage";
import type {
  StorefrontDiscoveryDto,
  StorefrontDiscoveryProductDto,
} from "@/modules/storefront/application/dto/StorefrontDiscoveryDto";
import { ensurePublicStorefrontTenant } from "@/modules/storefront/application/services/ResolvePublicStorefrontContextService";
import { fromBaseQuantity } from "@/core/units";

export class GetStorefrontDiscoveryService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(tenantSlug: string, tenantId: string): Promise<StorefrontDiscoveryDto> {
    // Auditoría §15/§30 (BLOCKER): el `tenantId` llega ya resuelto por el caller (hook via
    // `usePublicTenant`, que usa el modo `allowDisabled` -- NO exige entitlement); sin esta
    // revalidación, discovery seguía sirviendo catálogo aunque Subscription/Plan/capability
    // `ecommerce` ya no lo permitieran.
    await ensurePublicStorefrontTenant(this.repositories, tenantSlug, tenantId);
    const [
      products,
      activeCategories,
      ecommerceConfig,
      allProducts,
      balances,
      locations,
      lots,
      serials,
      units,
    ] = await Promise.all([
      this.repositories.products.getPublishedForEcommerce(tenantId),
      this.repositories.categories.getActive(),
      this.repositories.businessConfig.getEcommerceConfig(tenantId),
      this.repositories.products.getAll(),
      this.repositories.inventory.getBalances(),
      this.repositories.inventory.getLocations(),
      this.repositories.inventory.getLots(),
      this.repositories.inventory.getSerialNumbers(),
      this.repositories.units.getByTenant(tenantId),
    ]);
    const categories = activeCategories.filter((category) => category.tenantId === tenantId);
    const categoryNames = new Map(categories.map((category) => [category.id, category.name]));
    const productsById = new Map(
      allProducts
        .filter((product) => product.tenantId === tenantId)
        .map((product) => [product.id, product]),
    );
    const branchId = ecommerceConfig?.defaultBranchId;
    const at = new Date().toISOString();
    const productsWithMedia = await Promise.all(
      products.map(async (product): Promise<StorefrontDiscoveryProductDto> => {
        const [productMedia, components, salesPriceTiers] = await Promise.all([
          this.repositories.productMedia.getByProduct(product.id),
          product.productType === ProductType.kit
            ? this.repositories.productKitComponents.getByKitProduct(product.id)
            : Promise.resolve([]),
          this.repositories.productSalesPriceTiers.getByProduct(product.id),
        ]);
        const media = selectPrimaryProductMedia(
          productMedia.filter((item) => item.tenantId === tenantId),
        );
        const saleUnitId = product.saleUnitId ?? product.baseUnitId;
        const canonicalAvailable = getAvailableQuantity({
          product,
          components,
          productsById,
          tenantId,
          branchId,
          balances,
          lots,
          serials,
          locations,
          at,
        });
        const conversions = await this.repositories.units.getConversionsByProductScoped(
          tenantId,
          product.id,
        );
        let sellableAvailable: number | null = canonicalAvailable;
        if (canonicalAvailable !== null) {
          try {
            sellableAvailable = fromBaseQuantity(canonicalAvailable, {
              targetUnitId: saleUnitId,
              baseUnitId: product.baseUnitId,
              conversions,
            });
          } catch {
            sellableAvailable = 0;
          }
        }
        return {
          id: product.id,
          sku: product.sku,
          name: product.name,
          description: product.description,
          brand: product.brand,
          salePrice: product.salePrice,
          salesPriceTiers: salesPriceTiers
            .filter(
              (tier) => tier.tenantId === tenantId && tier.productId === product.id && tier.active,
            )
            .map(({ minQuantity, unitPrice, active }) => ({ minQuantity, unitPrice, active })),
          categoryId: product.categoryId,
          categoryName: categoryNames.get(product.categoryId),
          imageSource: media ? (getProductMediaSource(media) ?? undefined) : undefined,
          imageAlt: media?.alt,
          availableQuantity: sellableAvailable,
          saleUnitId,
          saleUnitName: units.find((unit) => unit.id === saleUnitId)?.name ?? saleUnitId,
        };
      }),
    );

    return {
      categories: categories.map(({ id, name, slug, description, image }) => ({
        id,
        name,
        slug,
        description,
        imageSource: normalizeCatalogImageSource(image) ?? undefined,
      })),
      products: productsWithMedia,
    };
  }
}

function getAvailableQuantity({
  product,
  components,
  productsById,
  tenantId,
  branchId,
  balances,
  lots,
  serials,
  locations,
  at,
}: {
  product: Parameters<typeof getCanonicalProductAvailability>[0]["product"];
  components: Array<{ componentProductId: string; quantityPerKit: number }>;
  productsById: ReadonlyMap<
    string,
    Parameters<typeof getCanonicalProductAvailability>[0]["product"]
  >;
  tenantId: string;
  branchId?: string;
  balances: Parameters<typeof getCanonicalProductAvailability>[0]["balances"];
  lots: Parameters<typeof getCanonicalProductAvailability>[0]["lots"];
  serials: Parameters<typeof getCanonicalProductAvailability>[0]["serials"];
  locations: Parameters<typeof getCanonicalProductAvailability>[0]["locations"];
  at: string;
}): number | null {
  if (product.productType === ProductType.service || !product.tracking.stock) return null;
  if (!branchId) return 0;
  if (product.productType === ProductType.physical) {
    return getCanonicalProductAvailability({
      product,
      tenantId,
      branchId,
      balances,
      lots,
      serials,
      locations,
      at,
    });
  }
  const componentAvailability = new Map(
    components.map((component) => {
      const componentProduct = productsById.get(component.componentProductId);
      const available = componentProduct
        ? getCanonicalProductAvailability({
            product: componentProduct,
            tenantId,
            branchId,
            balances,
            lots,
            serials,
            locations,
            at,
          })
        : 0;
      return [component.componentProductId, available];
    }),
  );
  return getCanonicalKitAvailability({ components, componentAvailability });
}
