import { describe, expect, it } from "vitest";
import type {
  PurchaseOrderAvailableProduct,
  PurchaseOrderEditorLine,
} from "@/modules/purchasing/application/dto/PurchaseOrderEditorModel";
import { getPurchaseAvailabilityLabel } from "@/modules/purchasing/application/services/PurchaseOrderEditorService";
import { mergeLineInventory } from "@/modules/purchasing/hooks/usePurchaseOrderEditor";

describe("purchasing replenishment contracts", () => {
  it("classifies availability with reorderPoint and uses the fallback only when absent", () => {
    expect(getPurchaseAvailabilityLabel(0, 10, 20)).toBe("Sin disponibilidad");
    expect(getPurchaseAvailabilityLabel(9, 10, 20)).toBe("Critico");
    expect(getPurchaseAvailabilityLabel(15, 10, 20)).toBe("Cerca del minimo");
    expect(getPurchaseAvailabilityLabel(12.5, 10, null)).toBe("Cerca del minimo");
    expect(getPurchaseAvailabilityLabel(13, 10, null)).toBe("Disponible");
  });

  it("refreshes physical/reserved/available metadata without overwriting manual input", () => {
    const line: PurchaseOrderEditorLine = {
      id: "line-1",
      productId: "product-1",
      productName: "Producto",
      sku: "SKU-1",
      supplierSku: "SUP-1",
      unitId: "unit-1",
      unitLabel: "Caja",
      unitAllowsDecimals: false,
      purchaseToBaseFactor: 12,
      quantity: 7,
      baseCost: 20,
      suggestedCost: 18,
      agreedCost: 17,
      subtotal: 119,
      manualCost: true,
      minimumOrderQuantity: 1,
      tiers: [],
      availabilityLabel: "Cargando inventario...",
    };
    const product: PurchaseOrderAvailableProduct = {
      id: "supplier-product-1",
      productId: "product-1",
      productName: "Producto",
      sku: "SKU-1",
      supplierSku: "SUP-1",
      categoryName: "Categoria",
      unitId: "unit-1",
      unitLabel: "Caja",
      unitAllowsDecimals: false,
      purchaseToBaseFactor: 12,
      configuredCost: 20,
      minimumOrderQuantity: 1,
      tiers: [],
      stockQuantity: 25,
      reservedQuantity: 9,
      availableQuantity: 16,
      minStock: 20,
      reorderPoint: 30,
      shortage: 4,
      suggestedReorder: 14,
      availabilityLabel: "Critico",
      searchText: "producto sku-1",
    };

    expect(mergeLineInventory(line, product)).toMatchObject({
      quantity: 7,
      agreedCost: 17,
      manualCost: true,
      stockQuantity: 25,
      reservedQuantity: 9,
      availableQuantity: 16,
      suggestedReorder: 14,
    });
  });
});
