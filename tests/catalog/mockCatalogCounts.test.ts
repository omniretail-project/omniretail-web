import { describe, expect, it } from "vitest";
import { LocationStatus, ProductStatus } from "@/core/enums";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { MockDatabaseStore } from "@/infrastructure/mock/database/MockDatabaseStore";
import { MockCategoryRepository } from "@/infrastructure/mock/repositories/MockCategoryRepository";
import { MockInventoryRepository } from "@/infrastructure/mock/repositories/MockInventoryRepository";
import { MemoryStorageAdapter } from "../inventory/mockInventoryFixtures";

const TS = "2026-10-09T12:00:00.000Z";

function createStore() {
  return new MockDatabaseStore(new MemoryStorageAdapter());
}

describe("MockCategoryRepository.getByTenantWithCounts", () => {
  function setup() {
    const store = createStore();
    const repository = new MockCategoryRepository(store, new DataEventBus());
    const base = store.getSnapshot();
    const tenantId = base.categories[0].tenantId;
    const template = base.products.find((product) => product.tenantId === tenantId);
    if (!template) throw new Error("La semilla demo no trae productos.");
    store.mutate((database) => {
      database.categories.push(
        { ...base.categories[0], id: "cat-counted", name: "Contada", slug: "contada" },
        { ...base.categories[0], id: "cat-empty", name: "Vacia", slug: "vacia" },
      );
      const clone = (id: string, status: ProductStatus, tenant = tenantId) =>
        database.products.push({
          ...template,
          id,
          sku: id.toUpperCase(),
          tenantId: tenant,
          categoryId: "cat-counted",
          status,
        });
      clone("p-pub-1", ProductStatus.published);
      clone("p-pub-2", ProductStatus.published);
      clone("p-arch-1", ProductStatus.archived);
      clone("p-other-tenant", ProductStatus.published, "tenant-other");
    });
    return { repository, tenantId };
  }

  it("counts published and archived products of the category separately", async () => {
    const { repository, tenantId } = setup();

    const entries = await repository.getByTenantWithCounts(tenantId);

    expect(entries.find((item) => item.category.id === "cat-counted")?.counts).toEqual({
      productCount: 2,
      archivedProductCount: 1,
    });
  });

  it("returns a real zero for a category without products", async () => {
    const { repository, tenantId } = setup();

    const entries = await repository.getByTenantWithCounts(tenantId);

    expect(entries.find((item) => item.category.id === "cat-empty")?.counts).toEqual({
      productCount: 0,
      archivedProductCount: 0,
    });
  });

  it("is isolated by tenant: other tenants' categories and products never count", async () => {
    const { repository, tenantId } = setup();

    const entries = await repository.getByTenantWithCounts(tenantId);

    expect(entries.every((item) => item.category.tenantId === tenantId)).toBe(true);
    expect(entries.find((item) => item.category.id === "cat-counted")?.counts.productCount).toBe(2);
  });
});

describe("MockInventoryRepository.getLocationsWithCounts", () => {
  function setup() {
    const store = createStore();
    const repository = new MockInventoryRepository(store, new DataEventBus());
    const base = store.getSnapshot();
    const location = base.storageLocations[0];
    const settings = base.productInventorySettings[0];
    const otherBranchId = "branch-other-count";
    store.mutate((database) => {
      database.storageLocations.push(
        { ...location, id: "loc-two", code: "L2", name: "Con dos", status: LocationStatus.active },
        { ...location, id: "loc-none", code: "L0", name: "Sin productos", status: LocationStatus.active },
        {
          ...location,
          id: "loc-elsewhere",
          code: "LE",
          name: "Otra sucursal",
          branchId: otherBranchId,
        },
      );
      const assign = (id: string, productId: string, locationId: string, branchId: string) =>
        database.productInventorySettings.push({
          ...settings,
          id,
          productId,
          branchId,
          defaultLocationId: locationId,
          minStock: 0,
          createdAt: TS,
          updatedAt: TS,
        });
      // Productos con cero existencias tambien cuentan: no hay balances para ninguno de estos.
      assign("s-a", "count-product-a", "loc-two", location.branchId);
      assign("s-b", "count-product-b", "loc-two", location.branchId);
      assign("s-c", "count-product-c", "loc-elsewhere", otherBranchId);
    });
    return { repository, branchId: location.branchId, otherBranchId };
  }

  it("counts the unique products assigned to a location, with or without stock", async () => {
    const { repository, branchId } = setup();

    const entries = await repository.getLocationsWithCounts(branchId);

    expect(entries.find((item) => item.location.id === "loc-two")?.assignedProductCount).toBe(2);
  });

  it("reports a real zero for a location nobody has assigned", async () => {
    const { repository, branchId } = setup();

    const entries = await repository.getLocationsWithCounts(branchId);

    expect(entries.find((item) => item.location.id === "loc-none")?.assignedProductCount).toBe(0);
  });

  it("keeps branches separate: the listing is scoped and each count stays in its branch", async () => {
    const { repository, branchId, otherBranchId } = setup();

    const scoped = await repository.getLocationsWithCounts(branchId);
    const other = await repository.getLocationsWithCounts(otherBranchId);

    expect(scoped.every((item) => item.location.branchId === branchId)).toBe(true);
    expect(scoped.some((item) => item.location.id === "loc-elsewhere")).toBe(false);
    expect(other.map((item) => [item.location.id, item.assignedProductCount])).toEqual([
      ["loc-elsewhere", 1],
    ]);
  });

  it("returns every branch when none is requested", async () => {
    const { repository } = setup();

    const all = await repository.getLocationsWithCounts();

    expect(all.find((item) => item.location.id === "loc-elsewhere")?.assignedProductCount).toBe(1);
    expect(all.find((item) => item.location.id === "loc-two")?.assignedProductCount).toBe(2);
  });
});
