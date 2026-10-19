import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  getProduct: vi.fn(),
  subscribe: vi.fn(() => () => undefined),
  tenant: {
    tenantId: "tenant-1",
    tenantSlug: "ferreteria",
    loading: false,
    error: null as string | null,
  },
}));

vi.mock("@/config/api-mode", () => ({ isApiMode: () => true }));
vi.mock("@/infrastructure/providers/RepositoryProvider", () => ({
  useRepositories: () => ({}),
  useDataEventBus: () => ({ subscribe: state.subscribe }),
}));
vi.mock("@/modules/storefront/providers/PublicTenantProvider", () => ({
  usePublicTenant: () => state.tenant,
}));
vi.mock("@/modules/storefront/application/services/GetStorefrontProductDetailService", () => ({
  GetStorefrontProductDetailService: class {},
}));
vi.mock("@/modules/storefront/application/services/ApiStorefrontCatalogService", () => ({
  ApiStorefrontCatalogService: class {
    getProduct = state.getProduct;
  },
}));

import { useStorefrontProductDetail } from "@/modules/storefront/hooks/useStorefrontProductDetail";

describe("useStorefrontProductDetail", () => {
  it("pasa atributos y sucursales del API al detalle que se muestra al cliente", async () => {
    state.getProduct.mockResolvedValue({
      id: "product-1",
      sku: "MAR-001",
      name: "Martillo",
      salePrice: 75,
      categoryId: "category-1",
      saleUnitId: "unit-1",
      saleUnitName: "Unidad",
      availableQuantity: 4,
      salesPriceTiers: [],
      attributes: [{ name: "Peso", value: "16 oz" }],
      availability: [{
        branchId: "branch-1",
        branchName: "Sucursal Centro",
        address: "Zona 1, Guatemala",
        available: true,
      }],
    });

    const { result } = renderHook(() => useStorefrontProductDetail("product-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data?.attributes).toEqual([{ name: "Peso", value: "16 oz" }]);
    expect(result.current.data?.availability).toEqual([{
      branchId: "branch-1",
      branchName: "Sucursal Centro",
      address: "Zona 1, Guatemala",
      available: true,
    }]);
  });

  it("informa el error del tenant cuando no puede determinar la tienda", async () => {
    state.tenant = {
      tenantId: "",
      tenantSlug: "",
      loading: false,
      error: "La tienda no existe.",
    };

    const { result } = renderHook(() => useStorefrontProductDetail("product-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("La tienda no existe.");
    expect(result.current.data).toBeNull();

    state.tenant = {
      tenantId: "tenant-1",
      tenantSlug: "ferreteria",
      loading: false,
      error: null,
    };
  });

  it("muestra un mensaje cuando el API no devuelve el producto", async () => {
    state.getProduct.mockReset().mockResolvedValue(null);

    const { result } = renderHook(() => useStorefrontProductDetail("missing"));

    await waitFor(() => expect(result.current.error).toBe("El producto no está disponible."));
  });
});
