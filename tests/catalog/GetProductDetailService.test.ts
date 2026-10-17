import { describe, expect, it, vi } from "vitest";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { GetProductDetailService } from "@/modules/catalog/application/services/GetProductDetailService";

const permissionsState = vi.hoisted(() => ({ current: [] as string[] }));

vi.mock("@/modules/catalog/application/services/serviceHelpers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/catalog/application/services/serviceHelpers")>()),
  resolveTenantContext: async () => ({ tenantId: "tenant-1", permissions: permissionsState.current }),
}));

function createRegistry() {
  return {
    products: {
      getByIdScoped: vi.fn().mockResolvedValue({
        id: "p1",
        tenantId: "tenant-1",
        categoryId: "cat-1",
        baseUnitId: "unit-1",
      }),
    },
    productMedia: { getByProduct: vi.fn().mockResolvedValue([]) },
    categories: { getByIdScoped: vi.fn().mockResolvedValue({ id: "cat-1", name: "Herramientas" }) },
    units: { getByIdScoped: vi.fn().mockResolvedValue({ id: "unit-1", name: "Unidad" }) },
  } as unknown as RepositoryRegistry;
}

function run(registry: RepositoryRegistry, permissions: string[]) {
  permissionsState.current = permissions;
  return new GetProductDetailService(registry).execute("p1");
}

describe("GetProductDetailService", () => {
  it("un rol operativo sin permisos de categorias ni unidades no las consulta y el detalle carga", async () => {
    const registry = createRegistry();

    const detail = await run(registry, ["catalog.products.read"]);

    expect(registry.categories.getByIdScoped).not.toHaveBeenCalled();
    expect(registry.units.getByIdScoped).not.toHaveBeenCalled();
    expect(detail?.product.id).toBe("p1");
    expect(detail?.category).toBeNull();
    expect(detail?.unit).toBeNull();
  });

  it("con lectura de categorias y unidades las resuelve", async () => {
    const registry = createRegistry();

    const detail = await run(registry, [
      "catalog.products.read",
      "catalog.categories.read",
      "catalog.units.manage",
    ]);

    expect(registry.categories.getByIdScoped).toHaveBeenCalledWith("tenant-1", "cat-1");
    expect(registry.units.getByIdScoped).toHaveBeenCalledWith("tenant-1", "unit-1");
    expect(detail?.category).toMatchObject({ name: "Herramientas" });
    expect(detail?.unit).toMatchObject({ name: "Unidad" });
  });

  it("devuelve null si el producto no existe", async () => {
    const registry = createRegistry();
    vi.mocked(registry.products.getByIdScoped).mockResolvedValue(null);

    expect(await run(registry, ["catalog.products.read"])).toBeNull();
  });
});
