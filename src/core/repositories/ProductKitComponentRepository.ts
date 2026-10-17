import type { ProductKitComponent } from "@/core/entities";

export interface ReplaceProductKitComponentInput {
  componentProductId: string;
  quantityPerKit: number;
}

export interface ProductKitComponentRepository {
  getByKitProduct(kitProductId: string): Promise<ProductKitComponent[]>;
  replaceForKit(
    tenantId: string,
    kitProductId: string,
    components: ReplaceProductKitComponentInput[],
  ): Promise<ProductKitComponent[]>;
}
