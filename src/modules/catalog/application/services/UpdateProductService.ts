import type { Product } from "@/core/entities";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { normalizeSku } from "@/shared/utils/normalizeSku";
import type { UpdateProductDto } from "@/modules/catalog/application/dto/UpdateProductDto";
import { ProductMapper } from "@/modules/catalog/application/mappers/ProductMapper";
import { ProductEditorPartialSaveError } from "@/modules/catalog/application/services/ProductEditorPartialSaveError";
import {
  applyTrackingRules,
  hasValidationErrors,
  resolveSaleUnitId,
  validateProductDto,
} from "@/modules/catalog/validation/product.validation";
import {
  CatalogServiceError,
  ensureActiveCategory,
  ensureActiveUnit,
  ensureCanUpdateProducts,
  ensureProduct,
  ensureProductTypeAllowed,
  ensureUnitConfigUnchanged,
  requireCapabilities,
  resolveTenantContext,
} from "@/modules/catalog/application/services/serviceHelpers";

export class UpdateProductService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(productId: string, dto: UpdateProductDto): Promise<Product> {
    const { tenantId, permissions } = await resolveTenantContext(this.repositories);
    ensureCanUpdateProducts(permissions);
    const baseErrors = validateProductDto(dto);
    if (hasValidationErrors(baseErrors)) {
      throw new CatalogServiceError(
        Object.values(baseErrors)[0] ?? "Revise los datos del producto.",
      );
    }
    const current = ensureProduct(
      await this.repositories.products.getByIdScoped(tenantId, productId),
    );
    const normalizedSku = normalizeSku(dto.sku);
    const duplicateSku = await this.repositories.products.getBySkuScoped(tenantId, normalizedSku);
    if (duplicateSku && duplicateSku.id !== current.id) {
      throw new CatalogServiceError("Ya existe un producto con este Codigo / SKU.");
    }

    if (dto.barcode?.trim()) {
      const products = await this.repositories.products.getByTenant(tenantId);
      const duplicateBarcode = products.find(
        (product) => product.barcode === dto.barcode?.trim() && product.id !== current.id,
      );
      if (duplicateBarcode) {
        throw new CatalogServiceError("Ya existe un producto con este codigo de barras.");
      }
    }

    const [category, unit] = await Promise.all([
      this.repositories.categories.getByIdScoped(tenantId, dto.categoryId),
      this.repositories.units.getByIdScoped(tenantId, dto.baseUnitId),
    ]);
    ensureActiveCategory(category);
    ensureActiveUnit(unit);

    const capabilities = await requireCapabilities(this.repositories, current.tenantId);
    ensureProductTypeAllowed(dto.productType, capabilities, current.productType);
    ensureUnitConfigUnchanged(dto, capabilities, current);
    // Producto existente: se conserva lo ya persistido (unidad de venta y tracking) en vez de
    // recortarlo si la capacidad correspondiente esta apagada. Ver product.validation.ts.
    const saleUnitId = resolveSaleUnitId(
      dto.baseUnitId,
      dto.saleUnitId,
      capabilities,
      current.saleUnitId ?? current.baseUnitId,
    );
    const tracking = applyTrackingRules(
      dto.productType,
      dto.tracking,
      capabilities,
      current.tracking,
    );
    const updated = await this.repositories.products.updateScoped(
      tenantId,
      current.id,
      ProductMapper.toUpdateInput({ ...dto, sku: normalizedSku, saleUnitId, tracking }, current),
    );

    if (dto.primaryImageUrl !== undefined) {
      try {
        await this.syncPrimaryImage(updated, dto.primaryImageUrl.trim());
      } catch (error) {
        throw new ProductEditorPartialSaveError(
          updated.id,
          true,
          ["media"],
          error instanceof Error ? [error.message] : [],
        );
      }
    }

    return updated;
  }

  private async syncPrimaryImage(product: Product, primaryImageUrl: string) {
    const primaryMedia = await this.repositories.productMedia.getPrimaryByProduct(
      product.id,
      product.tenantId,
    );

    if (!primaryImageUrl) {
      if (primaryMedia) {
        if (this.repositories.productMediaDataSource === "api") {
          await this.repositories.productMedia.removeFromProduct(product.id, primaryMedia.id);
        } else {
          await this.repositories.productMedia.remove(primaryMedia.id);
        }
      }
      return;
    }

    if (primaryMedia) {
      if (primaryMedia.url !== primaryImageUrl || primaryMedia.alt !== product.name) {
        if (
          this.repositories.productMediaDataSource === "api" &&
          primaryMedia.url.startsWith("/api/media/") &&
          primaryMedia.url !== primaryImageUrl
        ) {
          const media = await this.repositories.productMedia.getByProduct(
            product.id,
            product.tenantId,
          );
          const deleteFirst = media.length >= 6;
          if (deleteFirst) {
            await this.repositories.productMedia.removeFromProduct(product.id, primaryMedia.id);
          }
          const replacement = await this.addPrimaryUrl(product, primaryImageUrl);
          await this.repositories.productMedia.setPrimary(product.id, replacement.id);
          if (!deleteFirst) {
            await this.repositories.productMedia.removeFromProduct(product.id, primaryMedia.id);
          }
          return;
        }
        await this.repositories.productMedia.update({
          ...primaryMedia,
          url: primaryImageUrl,
          source: { kind: "url", src: primaryImageUrl },
          alt: product.name,
          isPrimary: true,
        });
      }
      return;
    }

    await this.addPrimaryUrl(product, primaryImageUrl);
  }

  private addPrimaryUrl(product: Product, primaryImageUrl: string) {
    return this.repositories.productMedia.add({
      tenantId: product.tenantId,
      productId: product.id,
      type: "image",
      url: primaryImageUrl,
      source: { kind: "url", src: primaryImageUrl },
      alt: product.name,
      isPrimary: true,
      sortOrder: this.repositories.productMediaDataSource === "mock" ? 1 : 0,
      createdAt: new Date().toISOString(),
    });
  }
}
