import type { Product } from "@/core/entities";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { normalizeSku } from "@/shared/utils/normalizeSku";
import type { CreateProductDto } from "@/modules/catalog/application/dto/CreateProductDto";
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
  ensureCanCreateProducts,
  ensureProductTypeAllowed,
  requireCapabilities,
  resolveTenantContext,
} from "@/modules/catalog/application/services/serviceHelpers";

export class CreateProductService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(dto: CreateProductDto): Promise<Product> {
    const { tenantId, permissions } = await resolveTenantContext(this.repositories);
    ensureCanCreateProducts(permissions);
    if (
      this.repositories.productMediaDataSource === "api" &&
      dto.primaryImageUrl?.trim() &&
      !permissions.includes("catalog.products.update")
    ) {
      throw new CatalogServiceError(
        "Guardar multimedia requiere permiso para actualizar productos.",
      );
    }
    const baseErrors = validateProductDto(dto);
    if (hasValidationErrors(baseErrors)) {
      throw new CatalogServiceError(
        Object.values(baseErrors)[0] ?? "Revise los datos del producto.",
      );
    }
    const normalizedSku = normalizeSku(dto.sku);
    const duplicateSku = await this.repositories.products.getBySkuScoped(tenantId, normalizedSku);
    if (duplicateSku) throw new CatalogServiceError("Ya existe un producto con este Codigo / SKU.");

    if (dto.barcode?.trim()) {
      const products = await this.repositories.products.getByTenant(tenantId);
      const duplicateBarcode = products.find((product) => product.barcode === dto.barcode?.trim());
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

    const capabilities = await requireCapabilities(this.repositories, tenantId);
    ensureProductTypeAllowed(dto.productType, capabilities);
    const saleUnitId = resolveSaleUnitId(dto.baseUnitId, dto.saleUnitId, capabilities);
    const tracking = applyTrackingRules(dto.productType, dto.tracking, capabilities);
    const product = await this.repositories.products.create(
      ProductMapper.toCreateInput({ ...dto, sku: normalizedSku, saleUnitId, tracking }, tenantId),
    );

    if (dto.primaryImageUrl?.trim()) {
      try {
        await this.repositories.productMedia.add({
          tenantId,
          productId: product.id,
          type: "image",
          url: dto.primaryImageUrl.trim(),
          source: { kind: "url", src: dto.primaryImageUrl.trim() },
          alt: product.name,
          isPrimary: true,
          sortOrder: this.repositories.productMediaDataSource === "mock" ? 1 : 0,
          createdAt: new Date().toISOString(),
        });
      } catch (error) {
        throw new ProductEditorPartialSaveError(
          product.id,
          true,
          ["media"],
          error instanceof Error ? [error.message] : [],
        );
      }
    }

    return product;
  }
}
