import type { Product } from "@/core/entities";
import { ProductStatus, ProductType } from "@/core/enums";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { ProductEditorDto } from "@/modules/catalog/application/dto/ProductEditorDto";
import { ProductMapper } from "@/modules/catalog/application/mappers/ProductMapper";
import {
  syncApiEditorRelatedData,
  syncApiProductMedia,
  syncEditorRelatedData,
  syncKitComponents,
  toProductDto,
  validateEditorProduct,
} from "@/modules/catalog/application/services/productEditorHelpers";
import {
  ProductEditorPartialSaveError,
  type ProductEditorFailedSection,
} from "@/modules/catalog/application/services/ProductEditorPartialSaveError";
import {
  CatalogServiceError,
  ensureCanUpdateProducts,
  ensureProduct,
  resolveTenantContext,
} from "@/modules/catalog/application/services/serviceHelpers";

export class UpdateProductWithCommercialDataService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(productId: string, dto: ProductEditorDto): Promise<Product> {
    const { tenantId, permissions } = await resolveTenantContext(this.repositories);
    ensureCanUpdateProducts(permissions);
    const current = ensureProduct(
      await this.repositories.products.getByIdScoped(tenantId, productId),
    );
    const { normalizedDto, capabilities, isNewProduct } = await validateEditorProduct(
      this.repositories,
      dto,
      current.tenantId,
      current,
    );
    if (this.repositories.productDataSource === "mock") {
      const updated = await this.repositories.products.updateScoped(
        tenantId,
        current.id,
        ProductMapper.toUpdateInput(toProductDto(normalizedDto), current),
      );
      await syncEditorRelatedData(this.repositories, updated, normalizedDto, {
        capabilities,
        isNewProduct,
      });
      return updated;
    }

    if (current.status === ProductStatus.archived) {
      if (hasCoreChanges(current, normalizedDto)) {
        throw new CatalogServiceError(
          "El producto archivado no admite cambios generales. Restaurelo antes de editar esos campos.",
        );
      }
      if (current.productType !== ProductType.kit) {
        throw new CatalogServiceError(
          "Restaure el producto antes de editarlo.",
        );
      }
      const failedSections: ProductEditorFailedSection[] = [];
      const failureMessages: string[] = [];
      try {
        await syncKitComponents(this.repositories, current, normalizedDto);
      } catch (error) {
        failedSections.push("kitComponents");
        if (error instanceof Error && error.message) failureMessages.push(error.message);
      }
      try {
        await syncApiProductMedia(this.repositories, current, normalizedDto.media);
      } catch (error) {
        failedSections.push("media");
        if (error instanceof Error && error.message) failureMessages.push(error.message);
      }
      if (failedSections.length > 0) {
        throw new ProductEditorPartialSaveError(
          current.id,
          false,
          failedSections,
          failureMessages,
        );
      }
      try {
        return (
          (await this.repositories.products.getByIdScoped(tenantId, current.id)) ?? current
        );
      } catch {
        throw new ProductEditorPartialSaveError(current.id, false, ["canonicalReload"]);
      }
    }

    if (normalizedDto.status !== current.status) {
      throw new CatalogServiceError(
        "Use las acciones de archivar o restaurar para cambiar el estado del producto.",
      );
    }
    const updated = await this.repositories.products.updateScoped(
      tenantId,
      current.id,
      ProductMapper.toUpdateInput(toProductDto(normalizedDto), current),
    );
    const failedSections: ProductEditorFailedSection[] = [];
    const failureMessages: string[] = [];
    if (Number(normalizedDto.salePrice) !== current.salePrice) {
      try {
        await this.repositories.products.updatePrice(
          current.id,
          Number(normalizedDto.salePrice),
          "Actualizacion desde el editor de producto",
        );
      } catch (error) {
        failedSections.push("price");
        if (error instanceof Error && error.message) failureMessages.push(error.message);
      }
    }
    const relatedResult = await syncApiEditorRelatedData(
      this.repositories,
      updated,
      normalizedDto,
      { permissions, capabilities, isNewProduct },
    );
    failedSections.push(...relatedResult.failedSections);
    failureMessages.push(...relatedResult.failureMessages);
    if (failedSections.length > 0) {
      throw new ProductEditorPartialSaveError(
        current.id,
        true,
        failedSections,
        failureMessages,
      );
    }
    try {
      return (await this.repositories.products.getByIdScoped(tenantId, current.id)) ?? updated;
    } catch {
      throw new ProductEditorPartialSaveError(current.id, true, ["canonicalReload"]);
    }
  }
}

function hasCoreChanges(current: Product, dto: ProductEditorDto) {
  const next = ProductMapper.toUpdateInput(toProductDto(dto), current);
  return (
    next.sku !== current.sku ||
    next.barcode !== current.barcode ||
    next.name !== current.name ||
    next.description !== current.description ||
    next.brand !== current.brand ||
    next.productType !== current.productType ||
    next.categoryId !== current.categoryId ||
    next.baseUnitId !== current.baseUnitId ||
    next.inventoryUnitId !== current.inventoryUnitId ||
    next.saleUnitId !== current.saleUnitId ||
    next.salePrice !== current.salePrice ||
    next.status !== current.status ||
    JSON.stringify(next.tracking) !== JSON.stringify(current.tracking) ||
    JSON.stringify(next.channels) !== JSON.stringify(current.channels)
  );
}
