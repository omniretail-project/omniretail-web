import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { navigationConfig } from "@/config/navigation";
import { inventoryPermissions } from "@/modules/inventory/permissions";
import { isNavigationItemPermitted } from "@/shared/navigation/Sidebar";
import type { NavigationItem } from "@/shared/types/navigation.types";

function flatten(items: NavigationItem[]): NavigationItem[] {
  return items.flatMap((item) => [item, ...flatten(item.children ?? [])]);
}

describe("location regularization navigation", () => {
  const item = flatten(navigationConfig).find(
    (candidate) => candidate.href === "/inventario/regularizacion",
  );

  it("registers the route in the aggregated navigation under Inventory", () => {
    expect(item).toBeDefined();
    expect(item?.id).toBe("inventory-location-regularization");
    // El tipo literal de cada modulo no declara `children` en todos los miembros de la union:
    // se estrecha al contrato NavigationItem (sin tocar la estructura global de navegacion).
    const topLevel: NavigationItem[] = navigationConfig;
    const inventory = topLevel.find((candidate) => candidate.id === "inventory");
    const childHrefs = (inventory?.children ?? []).map((child: NavigationItem) => child.href);
    expect(childHrefs).toContain("/inventario/regularizacion");
  });

  it("requires an existing permission and hides the entry without it", () => {
    expect(item?.permission).toBe("inventory.adjustment.create");
    expect(inventoryPermissions.map((permission) => permission.key)).toContain(
      "inventory.adjustment.create",
    );
    expect(isNavigationItemPermitted(item!, new Set(["inventory.adjustment.create"]))).toBe(true);
    expect(isNavigationItemPermitted(item!, new Set(["inventory.stock.read"]))).toBe(false);
  });

  it("keeps the existing inventory entries", () => {
    const hrefs = flatten(navigationConfig).map((candidate) => candidate.href);
    expect(hrefs).toContain("/inventario/alertas");
    expect(hrefs).toContain("/inventario/movimientos");
  });

  it("has a route file under the private layout", () => {
    expect(
      existsSync(
        join(process.cwd(), "src", "app", "(private)", "inventario", "regularizacion", "page.tsx"),
      ),
    ).toBe(true);
  });
});
