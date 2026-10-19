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

  it("mapea el catálogo y conserva el comportamiento ante producto faltante o error", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([{
        id: "product-1",
        sku: "MAR-001",
        name: "Martillo",
        primaryImageUrl: " /media/martillo.png ",
        primaryImageAlt: " ",
        salePrice: "75",
        basePrice: "80",
        effectivePrice: "70",
        discountAmount: "10",
        promotionId: "promotion-1",
        categoryId: "tools",
        categoryName: "Herramientas",
        categoryImageUrl: "/media/tools.png",
        saleUnitId: "unit-1",
        saleUnitName: "Unidad",
        inStock: false,
      }, {
        id: "product-2",
        sku: "TOR-001",
        name: "Tornillos",
        salePrice: 20,
        categoryId: "tools",
        categoryName: "Herramientas",
      }])))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    const service = new ApiStorefrontCatalogService();

    const catalog = await service.list("ferreteria");

    expect(catalog.categories).toHaveLength(1);
    expect(catalog.products[0]).toMatchObject({
      salePrice: 75,
      basePrice: 80,
      effectivePrice: 70,
      discountAmount: 10,
      availableQuantity: 0,
      imageAlt: "Martillo",
    });
    expect(await service.getProduct("ferreteria", "missing")).toBeNull();
    await expect(service.getProduct("ferreteria", "broken")).rejects.toThrow(
      "No se pudo cargar el producto.",
    );
  });
});
