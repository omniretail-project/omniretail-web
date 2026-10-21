import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  getProduct: vi.fn(),
  listeners: new Map<string, (event: { tenantId?: string }) => void>(),
  subscribe: vi.fn((eventName: string, listener: (event: { tenantId?: string }) => void) => {
    state.listeners.set(eventName, listener);
    return () => state.listeners.delete(eventName);
  }),
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
      effectivePrice: 70,
      salesPriceTiers: [],
      finalPriceTiers: [{ minQuantity: 2, unitPrice: 60, active: true }],
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
    // Precio final del backend (con promoción) para 1 unidad y por cantidad.
    expect(result.current.data?.finalPricing).toEqual({
      basePrice: 70,
      tiers: [{ minQuantity: 2, unitPrice: 60, active: true }],
    });
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

  it("recarga el detalle cuando cambia el producto de la misma tienda", async () => {
    state.getProduct.mockReset().mockResolvedValue({
      id: "product-1",
      sku: "MAR-001",
      name: "Martillo",
      salePrice: 75,
      categoryId: "category-1",
      saleUnitId: "unit-1",
      saleUnitName: "Unidad",
      salesPriceTiers: [],
    });
    const { result } = renderHook(() => useStorefrontProductDetail("product-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const initialCalls = state.getProduct.mock.calls.length;

    state.listeners.get("product.changed")?.({ tenantId: "tenant-1" });
    await waitFor(() => expect(state.getProduct).toHaveBeenCalledTimes(initialCalls + 1));

    state.listeners.get("inventory.changed")?.({ tenantId: "other-tenant" });
  });

  it("muestra un mensaje cuando la consulta del API falla", async () => {
    state.getProduct.mockReset().mockRejectedValue(new Error("network"));
    const { result } = renderHook(() => useStorefrontProductDetail("product-1"));

    await waitFor(() => expect(result.current.error).toBe(
      "No se pudo cargar el producto. Intenta nuevamente.",
    ));
  });
});
