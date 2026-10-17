import type { ProductMedia } from "@/core/entities";
import { getProductMediaSource, selectPrimaryProductMedia } from "@/core/media/catalogImage";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { ProductDetailViewModel } from "@/modules/catalog/types/catalog.types";
import {
  ensureCanReadProducts,
  resolveTenantContext,
} from "@/modules/catalog/application/services/serviceHelpers";

export interface ProductDetailLoadResult {
  detail: ProductDetailViewModel;
  media: ProductMedia[];
}

export class GetProductDetailService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(productId: string): Promise<ProductDetailViewModel | null> {
    const result = await this.executeWithMedia(productId);
    return result?.detail ?? null;
  }

  async executeWithMedia(
    productId: string,
    context?: Awaited<ReturnType<typeof resolveTenantContext>>,
  ): Promise<ProductDetailLoadResult | null> {
    const { tenantId, permissions } =
      context ?? (await resolveTenantContext(this.repositories));
    ensureCanReadProducts(permissions);
    const product = await this.repositories.products.getByIdScoped(tenantId, productId);
    if (!product) return null;

    // Categoria y unidad son lecturas aparte con su propio permiso: un rol operativo (Cajero,
    // Bodeguero) puede ver productos sin ellas, y un 403 no debe tumbar el detalle entero.
    const canReadCategories =
      permissions.includes("catalog.categories.read") ||
      permissions.includes("catalog.categories.manage");
    const canReadUnits =
      permissions.includes("catalog.units.read") || permissions.includes("catalog.units.manage");
    const [media, category, unit] = await Promise.all([
      this.repositories.productMedia.getByProduct(product.id, product.tenantId),
      canReadCategories
        ? this.repositories.categories.getByIdScoped(tenantId, product.categoryId)
        : Promise.resolve(null),
      canReadUnits
        ? this.repositories.units.getByIdScoped(tenantId, product.baseUnitId)
        : Promise.resolve(null),
    ]);

    const primaryMedia = selectPrimaryProductMedia(
      media.filter((item) => item.tenantId === product.tenantId),
    );
    return {
      detail: {
        product,
        imageSource: primaryMedia ? (getProductMediaSource(primaryMedia) ?? undefined) : undefined,
        category,
        unit,
      },
      media,
    };
  }
}
