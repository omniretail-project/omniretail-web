import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  getProduct: vi.fn(),
  subscribe: vi.fn(() => () => undefined),
}));

vi.mock("@/config/api-mode", () => ({ isApiMode: () => true }));
vi.mock("@/infrastructure/providers/RepositoryProvider", () => ({
  useRepositories: () => ({}),
  useDataEventBus: () => ({ subscribe: state.subscribe }),
}));
vi.mock("@/modules/storefront/providers/PublicTenantProvider", () => ({
  usePublicTenant: () => ({
    tenantId: "tenant-1",
    tenantSlug: "ferreteria",
    loading: false,
    error: null,
  }),
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
});
