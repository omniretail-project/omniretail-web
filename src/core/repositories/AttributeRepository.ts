import type { AttributeDefinition, ProductAttributeValue } from "@/core/entities";
export interface AttributeRepository {
  getDefinitions(): Promise<AttributeDefinition[]>;
  getValuesByProduct(productId: string): Promise<ProductAttributeValue[]>;
  createDefinition(
    input: Omit<AttributeDefinition, "id" | "createdAt" | "updatedAt">,
  ): Promise<AttributeDefinition>;
  updateDefinition(
    id: string,
    input: Partial<Omit<AttributeDefinition, "id" | "createdAt" | "updatedAt">>,
  ): Promise<AttributeDefinition>;
  setProductValue(input: Omit<ProductAttributeValue, "id">): Promise<ProductAttributeValue>;
  replaceValuesForProduct(
    productId: string,
    values: Omit<ProductAttributeValue, "id" | "productId">[],
  ): Promise<ProductAttributeValue[]>;
}
