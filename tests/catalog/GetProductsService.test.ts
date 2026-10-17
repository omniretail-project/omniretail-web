import { describe, expect, it, vi } from "vitest";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { GetProductsService } from "@/modules/catalog/application/services/GetProductsService";

const permissionsState = vi.hoisted(() => ({ current: [] as string[] }));

vi.mock("@/modules/catalog/application/services/serviceHelpers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/catalog/application/services/serviceHelpers")>()),
  resolveTenantContext: async () => ({ tenantId: "tenant-1", permissions: permissionsState.current }),
}));

const emptyFilters = {
  search: "",
  status: "all",
  productType: "all",
  categoryId: "all",
  channels: [],
  promotion: "all",
};

function createRegistry() {
  return {
    productDataSource: "api",
    products: {
      getPageScoped: vi.fn().mockResolvedValue({
        items: [
          {
            id: "p1",
            tenantId: "tenant-1",
            sku: "SKU-1",
            name: "Martillo",
            categoryId: "cat-1",
            baseUnitId: "unit-1",
            status: "draft",
            salePrice: 10,
            channels: [],
          },
        ],
        page: 1,
        pageSize: 10,
        totalItems: 1,
        totalPages: 1,
      }),
    },
    categories: {
      getByTenant: vi.fn().mockResolvedValue([{ id: "cat-1", name: "Herramientas", status: "active" }]),
    },
    units: { getByTenant: vi.fn().mockResolvedValue([{ id: "unit-1", name: "Unidad" }]) },
    promotions: { getActiveByTenant: vi.fn().mockResolvedValue([]) },
  } as unknown as RepositoryRegistry;
}

function run(registry: RepositoryRegistry, permissions: string[]) {
  permissionsState.current = permissions;
  return new GetProductsService(registry).execute({
    page: 1,
    pageSize: 10,
    filters: emptyFilters,
  } as never);
}

describe("GetProductsService (modo api)", () => {
  it("un rol solo con permisos de producto no pide categorias ni unidades y usa nombres por defecto", async () => {
    const registry = createRegistry();

    const result = await run(registry, ["catalog.products.update"]);

    expect(registry.categories.getByTenant).not.toHaveBeenCalled();
    expect(registry.units.getByTenant).not.toHaveBeenCalled();
    expect(registry.promotions.getActiveByTenant).not.toHaveBeenCalled();
    expect(result.items[0]).toMatchObject({
      categoryName: "Sin categoria",
      baseUnitName: "Sin unidad",
    });
    expect(result.categories).toEqual([]);
  });

  it("con permisos de categorias y unidades resuelve sus nombres", async () => {
    const registry = createRegistry();

    const result = await run(registry, [
      "catalog.products.read",
      "catalog.categories.manage",
      "catalog.units.read",
    ]);

    expect(registry.categories.getByTenant).toHaveBeenCalledWith("tenant-1");
    expect(registry.units.getByTenant).toHaveBeenCalledWith("tenant-1");
    expect(result.items[0]).toMatchObject({
      categoryName: "Herramientas",
      baseUnitName: "Unidad",
    });
  });

  it("solo pide las promociones si el rol puede leerlas", async () => {
    const registry = createRegistry();

    await run(registry, ["catalog.products.read", "catalog.promotions.read"]);

    expect(registry.promotions.getActiveByTenant).toHaveBeenCalledWith("tenant-1");
  });

  it("rechaza a quien no puede leer productos", async () => {
    await expect(run(createRegistry(), ["catalog.units.read"])).rejects.toThrow(
      "No dispone de permisos para consultar productos.",
    );
  });
});
