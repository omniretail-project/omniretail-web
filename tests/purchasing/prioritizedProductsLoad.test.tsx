import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProductType, UserStatus, UserType } from "@/core/enums";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { INVENTORY_STOCK_READ_PERMISSION } from "@/modules/inventory/application/services/serviceHelpers";
import {
  PURCHASE_PRODUCT_READ_CONCURRENCY,
  PurchaseOrderEditorService,
  PurchaseOrderLoadSupersededError,
} from "@/modules/purchasing/application/services/PurchaseOrderEditorService";
import { usePurchaseOrderEditor } from "@/modules/purchasing/hooks/usePurchaseOrderEditor";

const mocks = vi.hoisted(() => ({
  repositories: {} as object,
  branch: {
    currentBranch: { id: "branch-1", tenantId: "tenant-1", name: "Central" },
    loading: false,
  },
}));

vi.mock("@/infrastructure/providers/RepositoryProvider", () => ({
  useRepositories: () => mocks.repositories,
}));

vi.mock("@/modules/auth/hooks/useCurrentSession", () => ({
  useCurrentSession: () => ({ loading: false }),
}));

vi.mock("@/shared/navigation/PrivateHeader/ActiveBranchProvider", () => ({
  useActiveBranch: () => mocks.branch,
}));

vi.mock("@/shared/hooks/useDataEvent", () => ({
  useDataEvent: () => undefined,
}));

const TENANT = "tenant-1";
const OTHER_TENANT = "tenant-2";
const BRANCH = "branch-1";
const SUPPLIER = "supplier-1";
const PRIORITY = "product-0";
const PREFILL = {
  productId: PRIORITY,
  supplierId: SUPPLIER,
  branchId: BRANCH,
  suggestedQuantity: 3,
  source: "inventory" as const,
};

interface FixtureOptions {
  productCount?: number;
  /** Las lecturas de productos distintos al prioritario quedan bloqueadas hasta release(). */
  gateOthers?: boolean;
  foreignProductId?: string;
  productDataSource?: "api" | "mock";
  branchTenantId?: string;
}

function createFixture(options: FixtureOptions = {}) {
  const count = options.productCount ?? 6;
  const ids = Array.from({ length: count }, (_, index) => `product-${index}`);
  const reads: string[] = [];
  const batches: Array<{ branchId: string; productIds: string[] }> = [];
  let inFlight = 0;
  let maxInFlight = 0;
  let supplierProductCalls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const user = {
    id: "user-1",
    tenantId: TENANT,
    status: UserStatus.active,
    type: UserType.customer,
    roleId: "role-1",
    allowedBranchIds: [BRANCH, "branch-2"],
  };
  const role = {
    id: "role-1",
    tenantId: TENANT,
    status: "active",
    permissions: ["purchasing.orders.create", INVENTORY_STOCK_READ_PERMISSION],
  };
  const products = new Map(
    ids.map((id, index) => [
      id,
      {
        id,
        tenantId: id === options.foreignProductId ? OTHER_TENANT : TENANT,
        name: `Producto ${index}`,
        sku: `SKU-${index}`,
        productType: index === 3 ? ProductType.kit : ProductType.physical,
        tracking: { stock: true, lot: false, expiration: false, serial: false },
      },
    ]),
  );
  const supplierProducts = ids.map((id, index) => ({
    id: `sp-${index}`,
    tenantId: TENANT,
    supplierId: SUPPLIER,
    productId: id,
    purchaseUnitId: "unit-1",
    purchaseToBaseFactor: 1,
    lastCost: 10,
    minimumOrderQuantity: 1,
    active: true,
    costTiers: [],
  }));

  const repositories = {
    productDataSource: options.productDataSource ?? "api",
    inventoryStockDataSource: "api",
    auth: {
      getCurrentSessionId: async () => "session-1",
      getSession: async () => ({ id: "session-1", userId: user.id }),
    },
    users: { getById: async () => user },
    roles: { getByIdScoped: async () => role },
    tenants: { getById: async () => ({ id: TENANT, status: "active" }) },
    suppliers: {
      getActiveByTenant: async () => [
        { id: SUPPLIER, tenantId: TENANT, name: "Proveedor", leadTimeDays: 3 },
      ],
    },
    branches: {
      getById: async (id: string) => ({ id, tenantId: options.branchTenantId ?? TENANT }),
    },
    supplierProducts: {
      getBySupplierForTenant: async () => {
        supplierProductCalls += 1;
        return supplierProducts;
      },
      getByProductForTenant: async (_tenantId: string, productId: string) =>
        supplierProducts.filter((item) => item.productId === productId),
      getCostTiers: async () => [],
    },
    products: {
      getById: async (id: string) => {
        reads.push(id);
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        try {
          if (options.gateOthers && id !== PRIORITY) await gate;
          else await Promise.resolve();
          return products.get(id) ?? null;
        } finally {
          inFlight -= 1;
        }
      },
    },
    units: {
      getByTenant: async () => [
        { id: "unit-1", symbol: "u", name: "Unidad", allowsDecimals: false },
      ],
    },
    categories: { getByTenant: async () => [] },
    inventory: {
      getStockBatch: async (input: { branchId: string; productIds: string[] }) => {
        batches.push({ branchId: input.branchId, productIds: [...input.productIds] });
        return {
          branchId: input.branchId,
          items: input.productIds.map((productId) => ({
            productId,
            quantity: 5,
            reservedQuantity: 1,
            availableQuantity: 4,
            minStock: 2,
            reorderPoint: null,
            suggestedReorder: 3,
          })),
        };
      },
    },
  } as unknown as RepositoryRegistry;

  return {
    repositories,
    reads,
    batches,
    release: () => release(),
    maxInFlight: () => maxInFlight,
    supplierProductCalls: () => supplierProductCalls,
  };
}

const prioritizedInput = {
  supplierId: SUPPLIER,
  branchId: BRANCH,
  priorityProductId: PRIORITY,
};

describe("PurchaseOrderEditorService.startPrioritizedAvailableProductsLoad", () => {
  it("resolves the prefilled product without waiting for the rest of the supplier catalog", async () => {
    const fixture = createFixture({ gateOthers: true });
    const service = new PurchaseOrderEditorService(fixture.repositories);
    await service.resolvePrefillContext(PREFILL);

    const load = await service.startPrioritizedAvailableProductsLoad(prioritizedInput);

    expect(load.priority).toMatchObject({
      productId: PRIORITY,
      sku: "SKU-0",
      unitId: "unit-1",
      configuredCost: 10,
      minimumOrderQuantity: 1,
    });
    // La carga resolvio con el catalogo bloqueado: solo hay lecturas en vuelo, hasta el limite de
    // concurrencia, y todavia ninguna lectura batch de existencias.
    expect(fixture.reads[0]).toBe(PRIORITY);
    expect(fixture.reads.length).toBeLessThanOrEqual(1 + PURCHASE_PRODUCT_READ_CONCURRENCY);
    expect(fixture.batches).toHaveLength(0);

    fixture.release();
    const catalog = await load.catalog;
    expect(catalog).toHaveLength(6);
    const inventory = await load.inventory;
    expect(inventory.find((item) => item.productId === PRIORITY)).toMatchObject({
      stockQuantity: 5,
      reservedQuantity: 1,
      availableQuantity: 4,
    });
  });

  it("reads every product once and performs a single batch for the eligible products", async () => {
    const fixture = createFixture();
    const service = new PurchaseOrderEditorService(fixture.repositories);
    await service.resolvePrefillContext(PREFILL);
    const load = await service.startPrioritizedAvailableProductsLoad(prioritizedInput);
    await load.inventory;

    expect(fixture.reads).toHaveLength(6);
    expect(new Set(fixture.reads).size).toBe(6);
    expect(fixture.supplierProductCalls()).toBe(1);
    expect(fixture.batches).toHaveLength(1);
    expect(fixture.batches[0].branchId).toBe(BRANCH);
    // product-3 es un kit: no tiene existencias propias y no viaja al batch.
    expect([...fixture.batches[0].productIds].sort()).toEqual([
      "product-0",
      "product-1",
      "product-2",
      "product-4",
      "product-5",
    ]);
  });

  it("issues fewer product reads than the previous full load for the same prefill", async () => {
    const previous = createFixture();
    const previousService = new PurchaseOrderEditorService(previous.repositories);
    await previousService.resolvePrefillContext(PREFILL);
    await previousService.startAvailableProductsLoad(SUPPLIER, BRANCH);

    const current = createFixture();
    const currentService = new PurchaseOrderEditorService(current.repositories);
    await currentService.resolvePrefillContext(PREFILL);
    await (
      await currentService.startPrioritizedAvailableProductsLoad(prioritizedInput)
    ).inventory;

    // Antes: el producto del prefill se leia dos veces. Ahora una sola vez por carga.
    expect(previous.reads.filter((id) => id === PRIORITY)).toHaveLength(2);
    expect(current.reads.filter((id) => id === PRIORITY)).toHaveLength(1);
    expect(current.reads.length).toBe(previous.reads.length - 1);
  });

  it("limits simultaneous product reads", async () => {
    const fixture = createFixture({ productCount: 12, gateOthers: true });
    const service = new PurchaseOrderEditorService(fixture.repositories);
    await service.resolvePrefillContext(PREFILL);
    const load = await service.startPrioritizedAvailableProductsLoad(prioritizedInput);

    await waitFor(() =>
      expect(fixture.maxInFlight()).toBe(PURCHASE_PRODUCT_READ_CONCURRENCY),
    );
    fixture.release();
    await load.catalog;

    expect(fixture.maxInFlight()).toBeLessThanOrEqual(PURCHASE_PRODUCT_READ_CONCURRENCY);
    expect(fixture.reads).toHaveLength(12);
  });

  it("stops launching reads and skips the batch when the load is superseded", async () => {
    let current = true;
    const fixture = createFixture({ productCount: 12, gateOthers: true });
    const service = new PurchaseOrderEditorService(fixture.repositories);
    await service.resolvePrefillContext(PREFILL);
    const load = await service.startPrioritizedAvailableProductsLoad({
      ...prioritizedInput,
      isCurrent: () => current,
    });
    await waitFor(() => expect(fixture.reads.length).toBeGreaterThan(1));

    current = false;
    fixture.release();

    const settled = await Promise.allSettled([load.catalog, load.inventory]);
    for (const outcome of settled) {
      expect(outcome.status).toBe("rejected");
      if (outcome.status === "rejected") {
        expect(outcome.reason).toBeInstanceOf(PurchaseOrderLoadSupersededError);
      }
    }
    expect(fixture.batches).toHaveLength(0);
    expect(fixture.reads.length).toBeLessThan(12);
  });

  it("keeps rejecting products from another tenant (priority and deferred)", async () => {
    const deferredForeign = createFixture({ foreignProductId: "product-4" });
    const deferredService = new PurchaseOrderEditorService(deferredForeign.repositories);
    await deferredService.resolvePrefillContext(PREFILL);
    const load = await deferredService.startPrioritizedAvailableProductsLoad(prioritizedInput);
    const settled = await Promise.allSettled([load.catalog, load.inventory]);
    for (const outcome of settled) {
      expect(outcome.status).toBe("rejected");
      if (outcome.status === "rejected") {
        expect(String(outcome.reason)).toContain("producto no disponible");
      }
    }
    expect(deferredForeign.batches).toHaveLength(0);

    const priorityForeign = createFixture({ foreignProductId: PRIORITY });
    const priorityService = new PurchaseOrderEditorService(priorityForeign.repositories);
    await expect(
      priorityService.startPrioritizedAvailableProductsLoad(prioritizedInput),
    ).rejects.toThrow("producto no disponible");
  });

  it("keeps validating the branch before reading the supplier catalog", async () => {
    const fixture = createFixture({ branchTenantId: OTHER_TENANT });
    const service = new PurchaseOrderEditorService(fixture.repositories);

    await expect(
      service.startPrioritizedAvailableProductsLoad(prioritizedInput),
    ).rejects.toThrow("sucursal seleccionada");
    expect(fixture.supplierProductCalls()).toBe(0);
    expect(fixture.reads).toHaveLength(0);
  });

  it("returns no priority product when the supplier does not offer it, still loading the catalog", async () => {
    const fixture = createFixture();
    const service = new PurchaseOrderEditorService(fixture.repositories);
    const load = await service.startPrioritizedAvailableProductsLoad({
      ...prioritizedInput,
      priorityProductId: "product-unknown",
    });

    expect(load.priority).toBeNull();
    expect(await load.catalog).toHaveLength(6);
  });

  it("keeps the complete load outside API mode", async () => {
    const fixture = createFixture({ productDataSource: "mock" });
    const service = new PurchaseOrderEditorService(fixture.repositories);
    const load = await service.startPrioritizedAvailableProductsLoad(prioritizedInput);

    expect(load.priority?.productId).toBe(PRIORITY);
    expect(await load.catalog).toHaveLength(6);
    // Todo el catalogo ya se leyo antes de resolver (comportamiento previo).
    expect(fixture.reads).toHaveLength(6);
  });
});

describe("usePurchaseOrderEditor prefill", () => {
  it("shows the prefilled line before the supplier catalog finishes loading", async () => {
    const fixture = createFixture({ gateOthers: true });
    mocks.repositories = fixture.repositories;
    mocks.branch.currentBranch = { id: BRANCH, tenantId: TENANT, name: "Central" };

    const { result } = renderHook(() => usePurchaseOrderEditor(undefined, PREFILL));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.model.supplierId).toBe(SUPPLIER);
    expect(result.current.model.lines.map((line) => line.productId)).toEqual([PRIORITY]);
    expect(result.current.catalogLoading).toBe(true);
    // El producto ya agregado no se ofrece de nuevo y el resto sigue cargando.
    expect(result.current.availableProducts).toHaveLength(0);

    act(() => fixture.release());
    await waitFor(() => expect(result.current.catalogLoading).toBe(false));
    expect(result.current.availableProducts.map((item) => item.productId).sort()).toEqual([
      "product-1",
      "product-2",
      "product-3",
      "product-4",
      "product-5",
    ]);
    await waitFor(() => expect(result.current.model.lines[0].availableQuantity).toBe(4));
    expect(fixture.batches).toHaveLength(1);
  });

  it("discards the previous load when the active branch changes", async () => {
    const fixture = createFixture({ productCount: 8, gateOthers: true });
    mocks.repositories = fixture.repositories;
    mocks.branch.currentBranch = { id: BRANCH, tenantId: TENANT, name: "Central" };

    const { result, rerender } = renderHook(() => usePurchaseOrderEditor(undefined, PREFILL));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mocks.branch.currentBranch = { id: "branch-2", tenantId: TENANT, name: "Norte" };
    rerender();
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => fixture.release());
    await waitFor(() => expect(result.current.catalogLoading).toBe(false));
    await waitFor(() => expect(result.current.model.lines[0]?.availableQuantity).toBe(4));

    expect(fixture.batches.map((batch) => batch.branchId)).toEqual(["branch-2"]);
  });
});
