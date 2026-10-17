import { describe, expect, it, vi } from "vitest";
import { LocationStatus } from "@/core/enums";
import type { ProductRepository } from "@/core/repositories";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { withApiInventoryStock } from "@/infrastructure/api/withApiInventoryStock";
import { ApiLocationRepository } from "@/infrastructure/api/repositories/ApiLocationRepository";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import {
  ASSIGNED_LOCATION_STATUS_CONFLICT_MESSAGE,
  toLocationStatusMutationError,
} from "@/modules/catalog/application/services/SaveLocationService";

const id = (suffix: number) => `20000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;

const ids = {
  tenant: id(1),
  branch: id(2),
  product: id(3),
  settings: id(4),
  location: id(5),
};

const timestamp = "2026-10-09T12:00:00.000Z";

function settingsResponse(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: ids.settings,
    branchId: ids.branch,
    productId: ids.product,
    minStock: 5,
    reorderPoint: 9,
    defaultLocationId: ids.location,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function locationResponse(status: LocationStatus = LocationStatus.active) {
  return {
    id: ids.location,
    tenantId: ids.tenant,
    branchId: ids.branch,
    parentId: null,
    code: "BOD-1",
    name: "Bodega 1",
    type: "warehouse" as const,
    status,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function createRepository() {
  const products = { getById: vi.fn() } as unknown as ProductRepository;
  return { products, repository: new ApiLocationRepository(new DataEventBus(), products) };
}

describe("ApiLocationRepository inventory settings", () => {
  it("installs the real settings adapter after the stock adapter", async () => {
    const products = {
      getById: vi.fn(async () => ({ tenantId: ids.tenant })),
    } as unknown as ProductRepository;
    const configured = withApiInventoryStock(
      {
        products,
        inventory: {},
        inventoryAdjustments: {},
      } as unknown as RepositoryRegistry,
      new DataEventBus(),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(settingsResponse())),
    );

    const settings = await configured.inventory.getProductInventorySettings(
      ids.product,
      ids.branch,
    );

    expect(settings).toMatchObject({
      tenantId: ids.tenant,
      defaultLocationId: ids.location,
    });
    expect(products.getById).toHaveBeenCalledWith(ids.product);
  });

  it("preserves omitted replacement fields with one current-settings read", async () => {
    const { products, repository } = createRepository();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PUT") {
        return Response.json(settingsResponse({ minStock: 12 }));
      }
      return Response.json(settingsResponse());
    });
    vi.stubGlobal("fetch", fetchMock);

    await repository.upsertProductInventorySettings({
      tenantId: ids.tenant,
      branchId: ids.branch,
      productId: ids.product,
      minStock: 12,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(products.getById).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `/api/backend/inventory/settings/${ids.product}?branchId=${ids.branch}`,
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          minStock: 12,
          reorderPoint: 9,
          defaultLocationId: ids.location,
        }),
      }),
    );
  });

  it("sends explicit nulls without an unnecessary current-settings read", async () => {
    const { repository } = createRepository();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe("PUT");
      return Response.json(
        settingsResponse({ minStock: 7, reorderPoint: null, defaultLocationId: null }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const saved = await repository.upsertProductInventorySettings({
      tenantId: ids.tenant,
      branchId: ids.branch,
      productId: ids.product,
      minStock: 7,
      reorderPoint: null,
      defaultLocationId: null,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/backend/inventory/settings/${ids.product}?branchId=${ids.branch}`,
      expect.objectContaining({
        body: JSON.stringify({ minStock: 7, reorderPoint: null, defaultLocationId: null }),
      }),
    );
    expect(saved.reorderPoint).toBeUndefined();
    expect(saved.defaultLocationId).toBeUndefined();
  });
});

describe("ApiLocationRepository location conflicts", () => {
  it.each([
    [LocationStatus.inactive, "PUT"],
    [LocationStatus.archived, "DELETE"],
  ] as const)("preserves backend 409 for %s", async (status, method) => {
    const { repository } = createRepository();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "GET") return Response.json(locationResponse());
      expect(init?.method).toBe(method);
      return Response.json(
        { code: "LOCATION_ASSIGNED", message: "La ubicacion esta asignada." },
        { status: 409 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(repository.updateLocation(ids.location, { status })).rejects.toMatchObject({
      status: 409,
      code: "LOCATION_ASSIGNED",
    });
  });

  it("keeps the backend message for 409 conflicts that are not about assigned products", () => {
    const hasStock = toLocationStatusMutationError(
      new BackendRequestError(
        "La ubicación contiene inventario y no puede archivarse.",
        409,
        "LOCATION_HAS_STOCK",
      ),
      LocationStatus.archived,
    );

    expect(hasStock.message).toBe("La ubicación contiene inventario y no puede archivarse.");
    expect(
      toLocationStatusMutationError(
        new BackendRequestError("sin codigo", 409),
        LocationStatus.archived,
      ).message,
    ).toBe("sin codigo");
  });

  it("maps the backend assigned-to-products code and the mock's plain error alike", () => {
    expect(
      toLocationStatusMutationError(
        new BackendRequestError("asignada", 409, "LOCATION_ASSIGNED_TO_PRODUCTS"),
        LocationStatus.inactive,
      ).message,
    ).toBe(ASSIGNED_LOCATION_STATUS_CONFLICT_MESSAGE);
    expect(
      toLocationStatusMutationError(
        new Error("No se puede archivar ni inactivar una ubicacion asignada a productos."),
        LocationStatus.archived,
      ).message,
    ).toBe(ASSIGNED_LOCATION_STATUS_CONFLICT_MESSAGE);
  });

  it("maps an HTTP 409 to the approved catalog message", () => {
    const mapped = toLocationStatusMutationError(
      new BackendRequestError("conflict", 409, "LOCATION_ASSIGNED"),
      LocationStatus.archived,
    );

    expect(mapped.message).toBe(ASSIGNED_LOCATION_STATUS_CONFLICT_MESSAGE);
    expect(
      toLocationStatusMutationError(
        new BackendRequestError("bad request", 400),
        LocationStatus.inactive,
      ).message,
    ).toBe("bad request");
    expect(
      toLocationStatusMutationError(
        new BackendRequestError("duplicate", 409),
        LocationStatus.active,
      ).message,
    ).toBe("duplicate");
  });
});
