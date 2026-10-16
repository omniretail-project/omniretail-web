import { afterEach, describe, expect, it, vi } from "vitest";
import { ProductType } from "@/core/enums";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { PosProductDto } from "@/modules/pos/application/dto/PosProductDto";
import {
  getCachedPosProducts,
  invalidatePosProductsCache,
  POS_PRODUCTS_CACHE_TTL_MS,
} from "@/modules/pos/hooks/posProductsCache";

const products: PosProductDto[] = [
  {
    productId: "product-1",
    sku: "POS-001",
    name: "Producto POS",
    productType: ProductType.physical,
    basePrice: 50,
    effectivePrice: 50,
    discount: 0,
    salesPriceTiers: [],
    availableQuantity: 10,
    saleUnitId: "unit-1",
    saleUnitName: "Unidad",
    tracksStock: true,
    requiresLot: false,
    requiresSerial: false,
    requiresUnsupportedTraceability: false,
    isAvailableForSale: true,
  },
];

function repositories() {
  return {} as RepositoryRegistry;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("posProductsCache", () => {
  it("reutiliza el catálogo mientras la entrada sigue vigente", async () => {
    const registry = repositories();
    const load = vi.fn().mockResolvedValue(products);

    await expect(getCachedPosProducts(registry, "tenant:branch", load)).resolves.toEqual(products);
    await expect(getCachedPosProducts(registry, "tenant:branch", load)).resolves.toEqual(products);

    expect(load).toHaveBeenCalledTimes(1);
  });

  it("comparte una carga pendiente para el mismo contexto", async () => {
    const registry = repositories();
    const pending = deferred<PosProductDto[]>();
    const load = vi.fn(() => pending.promise);

    const firstRequest = getCachedPosProducts(registry, "tenant:branch", load);
    const secondRequest = getCachedPosProducts(registry, "tenant:branch", load);
    pending.resolve(products);

    await expect(Promise.all([firstRequest, secondRequest])).resolves.toEqual([products, products]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("vuelve a cargar cuando se invalida el catálogo", async () => {
    const registry = repositories();
    const load = vi.fn().mockResolvedValue(products);

    await getCachedPosProducts(registry, "tenant:branch", load);
    invalidatePosProductsCache(registry, "tenant:branch");
    await getCachedPosProducts(registry, "tenant:branch", load);

    expect(load).toHaveBeenCalledTimes(2);
  });

  it("vuelve a cargar cuando vence el tiempo de caché", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-15T12:00:00.000Z"));
    const registry = repositories();
    const load = vi.fn().mockResolvedValue(products);

    await getCachedPosProducts(registry, "tenant:branch", load);
    vi.advanceTimersByTime(POS_PRODUCTS_CACHE_TTL_MS + 1);
    await getCachedPosProducts(registry, "tenant:branch", load);

    expect(load).toHaveBeenCalledTimes(2);
  });

  it("descarta una carga fallida para permitir un reintento", async () => {
    const registry = repositories();
    const load = vi
      .fn<() => Promise<PosProductDto[]>>()
      .mockRejectedValueOnce(new Error("No se pudo cargar"))
      .mockResolvedValueOnce(products);

    await expect(getCachedPosProducts(registry, "tenant:branch", load)).rejects.toThrow("No se pudo cargar");
    await expect(getCachedPosProducts(registry, "tenant:branch", load)).resolves.toEqual(products);

    expect(load).toHaveBeenCalledTimes(2);
  });
});
