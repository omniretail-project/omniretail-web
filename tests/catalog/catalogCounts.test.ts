import { afterEach, describe, expect, it, vi } from "vitest";
import { CategoryStatus, LocationStatus } from "@/core/enums";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { ApiCategoryRepository } from "@/infrastructure/api/repositories/ApiCategoryRepository";
import { ApiLocationRepository } from "@/infrastructure/api/repositories/ApiLocationRepository";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { GetCategoriesService } from "@/modules/catalog/application/services/GetCategoriesService";
import { GetLocationsService } from "@/modules/catalog/application/services/GetLocationsService";

const permissionsState = vi.hoisted(() => ({ current: [] as string[] }));

vi.mock("@/modules/catalog/application/services/serviceHelpers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/catalog/application/services/serviceHelpers")>()),
  resolveTenantContext: async () => ({ tenantId: "tenant-1", permissions: permissionsState.current }),
}));

const id = (suffix: number) => `30000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const TENANT = id(1);
const SOUTH = id(2);
const NORTH = id(3);
const TS = "2026-10-09T12:00:00.000Z";

function apiCategory(overrides: Record<string, unknown> = {}) {
  return {
    id: id(10),
    tenantId: TENANT,
    parentId: null,
    name: "Herramientas",
    slug: "herramientas",
    description: null,
    imageUrl: null,
    status: CategoryStatus.active,
    createdAt: TS,
    updatedAt: TS,
    ...overrides,
  };
}

function apiLocation(overrides: Record<string, unknown> = {}) {
  return {
    id: id(20),
    tenantId: TENANT,
    branchId: NORTH,
    parentId: null,
    code: "PAS-N",
    name: "Pasillo Norte",
    type: "aisle",
    status: LocationStatus.active,
    createdAt: TS,
    updatedAt: TS,
    ...overrides,
  };
}

function page<T>(items: T[]) {
  return { items, page: 0, pageSize: 100, totalItems: items.length, totalPages: 1 };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ApiCategoryRepository product counts", () => {
  it("asks for the counts in the same single listing request", async () => {
    const fetchSpy = vi.fn<(url: string) => Promise<Response>>(async () =>
      Response.json([apiCategory({ productCount: 4, archivedProductCount: 1 })]),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const result = await new ApiCategoryRepository(new DataEventBus()).getByTenantWithCounts(TENANT);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain("includeCounts=true");
    expect(result[0].counts).toEqual({ productCount: 4, archivedProductCount: 1 });
  });

  it("keeps a real zero as zero", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json([apiCategory({ productCount: 0, archivedProductCount: 0 })])),
    );

    const [entry] = await new ApiCategoryRepository(new DataEventBus()).getByTenantWithCounts(TENANT);

    expect(entry.counts).toEqual({ productCount: 0, archivedProductCount: 0 });
  });

  it.each([
    ["null", { productCount: null, archivedProductCount: null }],
    ["missing (older backend)", {}],
    ["negative", { productCount: -1, archivedProductCount: -3 }],
    ["fractional", { productCount: 1.5, archivedProductCount: 0.2 }],
    ["not a number", { productCount: "4", archivedProductCount: true }],
  ])("reports %s counts as unavailable, never as zero", async (_label, counts) => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json([apiCategory(counts)])));

    const [entry] = await new ApiCategoryRepository(new DataEventBus()).getByTenantWithCounts(TENANT);

    expect(entry.counts).toEqual({ productCount: null, archivedProductCount: null });
  });

  it("keeps the count fields out of the Category entity", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json([apiCategory({ productCount: 4, archivedProductCount: 1 })])),
    );

    const [entry] = await new ApiCategoryRepository(new DataEventBus()).getByTenantWithCounts(TENANT);

    expect(entry.category).not.toHaveProperty("productCount");
    expect(entry.category).not.toHaveProperty("archivedProductCount");
    expect(entry.category.name).toBe("Herramientas");
  });

  it("does not request the counts for the plain listings used elsewhere", async () => {
    const fetchSpy = vi.fn(async () => Response.json([apiCategory()]));
    vi.stubGlobal("fetch", fetchSpy);

    await new ApiCategoryRepository(new DataEventBus()).getByTenant(TENANT);
    await new ApiCategoryRepository(new DataEventBus()).getActiveByTenant(TENANT);

    for (const call of fetchSpy.mock.calls as unknown as unknown[][]) {
      expect(String(call[0])).not.toContain("includeCounts");
    }
  });
});

describe("GetCategoriesService counts", () => {
  function registry(entries: unknown[]) {
    return {
      categories: { getByTenantWithCounts: vi.fn(async () => entries) },
      products: { getByTenant: vi.fn() },
    } as unknown as RepositoryRegistry;
  }

  function entry(
    categoryId: string,
    name: string,
    counts: { productCount: number | null; archivedProductCount: number | null },
    parentId?: string,
  ) {
    return {
      category: {
        id: categoryId,
        tenantId: "tenant-1",
        name,
        slug: name.toLowerCase(),
        parentId,
        status: CategoryStatus.active,
        createdAt: TS,
        updatedAt: TS,
      },
      counts,
    };
  }

  it("shows published, archived and zero counts as the backend reports them, without loading the catalog", async () => {
    permissionsState.current = ["catalog.categories.read"];
    const repositories = registry([
      entry("c1", "Herramientas", { productCount: 4, archivedProductCount: 1 }),
      entry("c2", "Pinturas", { productCount: 0, archivedProductCount: 0 }),
    ]);

    const items = await new GetCategoriesService(repositories).execute();

    expect(items.map((item) => [item.name, item.productCount, item.archivedProductCount])).toEqual([
      ["Herramientas", 4, 1],
      ["Pinturas", 0, 0],
    ]);
    expect(repositories.products.getByTenant).not.toHaveBeenCalled();
  });

  it("never turns an unknown count into zero", async () => {
    permissionsState.current = ["catalog.categories.read"];
    const items = await new GetCategoriesService(
      registry([entry("c1", "Herramientas", { productCount: null, archivedProductCount: null })]),
    ).execute();

    expect(items[0].productCount).toBeNull();
    expect(items[0].archivedProductCount).toBeNull();
  });

  it("does not add the products of subcategories to the parent", async () => {
    permissionsState.current = ["catalog.categories.read"];
    const items = await new GetCategoriesService(
      registry([
        entry("parent", "Herramientas", { productCount: 2, archivedProductCount: 0 }),
        entry("child", "Manuales", { productCount: 5, archivedProductCount: 0 }, "parent"),
      ]),
    ).execute();

    expect(items.map((item) => [item.name, item.depth, item.productCount])).toEqual([
      ["Herramientas", 0, 2],
      ["Manuales", 1, 5],
    ]);
  });

  it("requires permission to read categories", async () => {
    permissionsState.current = [];
    await expect(new GetCategoriesService(registry([])).execute()).rejects.toThrow(/permisos/);
  });
});

describe("ApiLocationRepository assigned product counts", () => {
  it("reads the count from the same paginated listing, per branch", async () => {
    const fetchSpy = vi.fn<(url: string) => Promise<Response>>(async () =>
      Response.json(page([apiLocation({ assignedProductCount: 3 }), apiLocation({ id: id(21), code: "EST-N", name: "Estante", assignedProductCount: 0 })])),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const result = await new ApiLocationRepository(new DataEventBus()).getLocationsWithCounts(NORTH);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain(`branchId=${NORTH}`);
    expect(result.map((item) => item.assignedProductCount)).toEqual([3, 0]);
  });

  it.each([
    ["missing", {}],
    ["null", { assignedProductCount: null }],
    ["negative", { assignedProductCount: -2 }],
    ["not an integer", { assignedProductCount: 2.5 }],
  ])("reports a %s count as unavailable, never as zero", async (_label, extra) => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(page([apiLocation(extra)]))));

    const [entry] = await new ApiLocationRepository(new DataEventBus()).getLocationsWithCounts(NORTH);

    expect(entry.assignedProductCount).toBeNull();
  });

  it("keeps the count out of the StorageLocation entity and does not change getLocations", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(page([apiLocation({ assignedProductCount: 3 })]))),
    );

    const locations = await new ApiLocationRepository(new DataEventBus()).getLocations(NORTH);

    expect(locations[0]).not.toHaveProperty("assignedProductCount");
    expect(locations[0].name).toBe("Pasillo Norte");
  });
});

describe("GetLocationsService counts", () => {
  function registry(entries: unknown[]) {
    return {
      inventory: { getLocationsWithCounts: vi.fn(async () => entries) },
      products: { getByTenant: vi.fn() },
      // Cualquier lectura por producto seria el N+1 que se debe evitar.
    } as unknown as RepositoryRegistry;
  }

  function entry(locationId: string, name: string, branchId: string, count: number | null, tenantId = "tenant-1") {
    return {
      location: {
        id: locationId,
        tenantId,
        branchId,
        code: name.toUpperCase(),
        name,
        type: "aisle",
        status: LocationStatus.active,
        createdAt: TS,
        updatedAt: TS,
      },
      assignedProductCount: count,
    };
  }

  it("maps the assigned products per location, including a real zero, in a single read", async () => {
    permissionsState.current = ["catalog.locations.read"];
    const repositories = registry([
      entry("l1", "Pasillo Norte", NORTH, 3),
      entry("l2", "Estante vacio", NORTH, 0),
    ]);

    const items = await new GetLocationsService(repositories).execute(NORTH);

    expect(repositories.inventory.getLocationsWithCounts).toHaveBeenCalledTimes(1);
    expect(repositories.inventory.getLocationsWithCounts).toHaveBeenCalledWith(NORTH);
    expect(items.map((item) => [item.name, item.productCount])).toEqual([
      ["Estante vacio", 0],
      ["Pasillo Norte", 3],
    ]);
    expect(repositories.products.getByTenant).not.toHaveBeenCalled();
  });

  it("keeps an unknown count as null instead of zero", async () => {
    permissionsState.current = ["catalog.locations.read"];

    const [item] = await new GetLocationsService(registry([entry("l1", "Pasillo", NORTH, null)])).execute(NORTH);

    expect(item.productCount).toBeNull();
  });

  it("keeps the locations of different branches separate and ignores other tenants", async () => {
    permissionsState.current = ["catalog.locations.read"];
    const repositories = registry([
      entry("l1", "Sur-1", SOUTH, 2),
      entry("l2", "Norte-1", NORTH, 5),
      entry("l3", "Ajena", NORTH, 9, "tenant-other"),
    ]);

    const items = await new GetLocationsService(repositories).execute();

    expect(items.map((item) => [item.name, item.branchId, item.productCount]).sort()).toEqual([
      ["Norte-1", NORTH, 5],
      ["Sur-1", SOUTH, 2],
    ]);
  });

  it("requires permission to read locations", async () => {
    permissionsState.current = [];
    await expect(new GetLocationsService(registry([])).execute(NORTH)).rejects.toThrow(/permisos/);
  });
});
