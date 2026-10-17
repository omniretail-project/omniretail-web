import type { Product } from "@/core/entities";
import { normalizeSku } from "@/shared/utils/normalizeSku";
import type { CreateProductDto } from "@/modules/catalog/application/dto/CreateProductDto";
import type { UpdateProductDto } from "@/modules/catalog/application/dto/UpdateProductDto";

type CreateProductInput = Omit<Product, "id" | "createdAt" | "updatedAt">;
type UpdateProductInput = Partial<Omit<Product, "id" | "createdAt" | "updatedAt">>;

function optionalText(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export const ProductMapper = {
  toCreateInput(dto: CreateProductDto, tenantId: string): CreateProductInput {
    return {
      tenantId,
      sku: normalizeSku(dto.sku),
      barcode: optionalText(dto.barcode),
      name: dto.name.trim(),
      description: optionalText(dto.description),
      brand: optionalText(dto.brand),
      productType: dto.productType,
      categoryId: dto.categoryId,
      baseUnitId: dto.baseUnitId,
      inventoryUnitId: dto.inventoryUnitId ?? dto.baseUnitId,
      saleUnitId: dto.saleUnitId,
      salePrice: dto.salePrice,
      status: dto.status,
      tracking: dto.tracking,
      channels: dto.channels,
    };
  },

  toUpdateInput(dto: UpdateProductDto, current: Product): UpdateProductInput {
    return {
      tenantId: current.tenantId,
      sku: normalizeSku(dto.sku),
      barcode: optionalText(dto.barcode),
      name: dto.name.trim(),
      description: optionalText(dto.description),
      brand: optionalText(dto.brand),
      productType: dto.productType,
      categoryId: dto.categoryId,
      baseUnitId: dto.baseUnitId,
      inventoryUnitId: dto.inventoryUnitId ?? dto.baseUnitId,
      saleUnitId: dto.saleUnitId,
      salePrice: dto.salePrice,
      status: dto.status,
      tracking: dto.tracking,
      channels: dto.channels,
    };
  },
};
