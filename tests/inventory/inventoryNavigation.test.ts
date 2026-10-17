import { describe, expect, it } from "vitest";
import { inventoryNavigation } from "@/modules/inventory/navigation";

describe("inventoryNavigation", () => {
  it("el historial de movimientos exige inventory.movements.read, igual que su pagina", () => {
    const item = inventoryNavigation[0].children.find((child) => child.id === "inventory-movements");

    expect(item?.permission).toBe("inventory.movements.read");
  });

  it("el resto del menu de inventario sigue pidiendo inventory.stock.read", () => {
    expect(inventoryNavigation[0].permission).toBe("inventory.stock.read");
    expect(
      inventoryNavigation[0].children.find((child) => child.id === "inventory-alerts")?.permission,
    ).toBe("inventory.stock.read");
  });
});
