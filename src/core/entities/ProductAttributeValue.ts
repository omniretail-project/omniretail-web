export type ProductAttributePrimitive = string | number | boolean;

export interface ProductAttributeValue {
  id?: string;
  productId: string;
  attributeDefinitionId: string;
  value: ProductAttributePrimitive;
  code?: string;
  name?: string;
  dataType?: "text" | "number" | "boolean";
  active?: boolean;
}
