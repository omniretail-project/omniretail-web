import { BranchType, ProductType } from "@/core/enums";
import {
  getCanonicalKitAvailability,
  getCanonicalProductAvailability,
} from "@/core/inventory/canonicalAvailability";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { StorefrontProductDetailDto } from "@/modules/storefront/application/dto/StorefrontProductDetailDto";
import { getProductMediaSource, sortProductMediaForDisplay } from "@/core/media/catalogImage";
import { GetStorefrontPublishedProductService } from "@/modules/storefront/application/services/GetStorefrontPublishedProductService";
import { ensurePublicStorefrontTenant } from "@/modules/storefront/application/services/ResolvePublicStorefrontContextService";

export class GetStorefrontProductDetailService {
  private readonly publishedProductService: GetStorefrontPublishedProductService;

  constructor(private readonly repositories: RepositoryRegistry) {
    this.publishedProductService = new GetStorefrontPublishedProductService(repositories);
  }

  async execute(tenantSlug: string, tenantId: string, productId: string): Promise<StorefrontProductDetailDto | null> {
    // Auditoría §15/§30 (BLOCKER): cierra el bypass donde discovery deniega pero `/product/:id`
    // seguía devolviendo datos -- mismo `tenantId` sin revalidar que llegaba desde el hook.
    await ensurePublicStorefrontTenant(this.repositories, tenantSlug, tenantId);
    const [
      product,
      allProducts,
      branches,
      balances,
      locations,
      lots,
      serials,
      categories,
      media,
      definitions,
      values,
    ] = await Promise.all([
      this.publishedProductService.execute(tenantId, productId),
      this.repositories.products.getAll(),
      this.repositories.branches.getActive(),
      this.repositories.inventory.getBalances(),
      this.repositories.inventory.getLocations(),
      this.repositories.inventory.getLots(),
      this.repositories.inventory.getSerialNumbers(),
      this.repositories.categories.getActive(),
      this.repositories.productMedia.getByProduct(productId),
      this.repositories.attributes.getDefinitions(),
      this.repositories.attributes.getValuesByProduct(productId),
    ]);
    if (!product) return null;

    const detail = {
      product,
      categoryName: categories.find(
        (category) => category.id === product.categoryId && category.tenantId === tenantId,
      )?.name,
      media: sortProductMediaForDisplay(media.filter((item) => item.tenantId === tenantId)).map(
        (item) => ({ source: getProductMediaSource(item)!, alt: item.alt }),
      ),
      attributes: values.flatMap((value) => {
        const definition = definitions.find(
          (item) =>
            item.id === value.attributeDefinitionId && item.tenantId === tenantId && item.active,
        );
        return definition ? [{ name: definition.name, value: String(value.value) }] : [];
      }),
    };

    if (product.productType === ProductType.service) return detail;

    const kitComponents =
      product.productType === ProductType.kit
        ? await this.repositories.productKitComponents.getByKitProduct(product.id)
        : [];
    const productsById = new Map(
      allProducts.filter((item) => item.tenantId === tenantId).map((item) => [item.id, item]),
    );
    const at = new Date().toISOString();

    const availability = branches
      .filter((branch) => branch.tenantId === tenantId && branch.type !== BranchType.warehouse)
      .map((branch) => ({
        branchId: branch.id,
        branchName: branch.name,
        address: branch.address,
        available:
          getAvailability({
            product,
            kitComponents,
            productsById,
            tenantId,
            branchId: branch.id,
            balances,
            lots,
            serials,
            locations,
            at,
          }) > 0,
      }));

    return { ...detail, availability };
  }
}

function getAvailability({
  product,
  kitComponents,
  productsById,
  tenantId,
  branchId,
  balances,
  lots,
  serials,
  locations,
  at,
}: {
  product: StorefrontProductDetailDto["product"];
  kitComponents: Array<{ componentProductId: string; quantityPerKit: number }>;
  productsById: ReadonlyMap<string, StorefrontProductDetailDto["product"]>;
  tenantId: string;
  branchId: string;
  balances: Parameters<typeof getCanonicalProductAvailability>[0]["balances"];
  lots: Parameters<typeof getCanonicalProductAvailability>[0]["lots"];
  serials: Parameters<typeof getCanonicalProductAvailability>[0]["serials"];
  locations: Parameters<typeof getCanonicalProductAvailability>[0]["locations"];
  at: string;
}): number {
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
    kitComponents.map((component) => {
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

  return getCanonicalKitAvailability({ components: kitComponents, componentAvailability });
}
