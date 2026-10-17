import type { ProductKitComponent } from "@/core/entities";

export function expandKitDemand(components: ProductKitComponent[], kitQuantity: number) {
  if (components.length === 0) throw new Error("A kit without components is not fulfillable");
  return components.map((component) => ({
    productId: component.componentProductId,
    quantity: component.quantityPerKit * kitQuantity,
  }));
}
