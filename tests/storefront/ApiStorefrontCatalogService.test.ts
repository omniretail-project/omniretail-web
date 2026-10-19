import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiStorefrontCatalogService } from "@/modules/storefront/application/services/ApiStorefrontCatalogService";

describe("ApiStorefrontCatalogService", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("conserva atributos y disponibilidad por sucursal del detalle público", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "product-1",
      sku: "MAR-001",
      name: "Martillo",
      salePrice: 75,
      categoryId: "category-1",
      inStock: true,
      availableQuantity: 4,
      attributes: [{ name: "Peso", value: "16 oz" }],
      availability: [{
        branchId: "branch-1",
        branchName: "Sucursal Centro",
        address: "Zona 1, Guatemala",
        available: true,
      }],
    })));
    vi.stubGlobal("fetch", fetchMock);

    const product = await new ApiStorefrontCatalogService().getProduct("ferre pharma", "product/1");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/backend/public/ferre%20pharma/products/product%2F1",
      { cache: "no-store" },
    );
    expect(product?.attributes).toEqual([{ name: "Peso", value: "16 oz" }]);
    expect(product?.availability).toEqual([{
      branchId: "branch-1",
      branchName: "Sucursal Centro",
      address: "Zona 1, Guatemala",
      available: true,
    }]);
  });
});
