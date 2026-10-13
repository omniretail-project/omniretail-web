import { afterEach, describe, expect, it, vi } from "vitest";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { ApiPurchaseOrderRepository } from "@/infrastructure/api/repositories/ApiPurchaseOrderRepository";

const IDS = {
  tenant: "10000000-0000-4000-8000-000000000001",
  branch: "10000000-0000-4000-8000-000000000002",
  supplier: "10000000-0000-4000-8000-000000000003",
  user: "10000000-0000-4000-8000-000000000004",
  order: "10000000-0000-4000-8000-000000000005",
};

afterEach(() => vi.unstubAllGlobals());

describe("ApiPurchaseOrderRepository search", () => {
  it("sends the trimmed search term to the paginated endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(pageResponse()));
    vi.stubGlobal("fetch", fetchMock);
    const repository = new ApiPurchaseOrderRepository(new DataEventBus());

    await repository.getPageScoped(IDS.tenant, {
      branchId: IDS.branch,
      search: "  martillo  ",
      page: 1,
      pageSize: 10,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/backend/purchasing/orders?branchId=${IDS.branch}&search=martillo&page=1&size=10`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("omits blank search terms", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(pageResponse()));
    vi.stubGlobal("fetch", fetchMock);
    const repository = new ApiPurchaseOrderRepository(new DataEventBus());

    await repository.getPageScoped(IDS.tenant, { search: "   ", page: 1, pageSize: 10 });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/backend/purchasing/orders?page=1&size=10",
      expect.objectContaining({ method: "GET" }),
    );
  });
});

function pageResponse() {
  return {
    items: [
      {
        id: IDS.order,
        branchId: IDS.branch,
        number: "OC-001",
        supplierId: IDS.supplier,
        supplierName: "Proveedor de prueba",
        status: "draft",
        expectedDate: null,
        notes: null,
        subtotal: 100,
        total: 100,
        createdByUserId: IDS.user,
        approvedByUserId: null,
        approvedAt: null,
        cancellationReason: null,
        cancelledByUserId: null,
        cancelledAt: null,
        createdAt: "2026-10-13T00:00:00Z",
        updatedAt: "2026-10-13T00:00:00Z",
        items: [],
      },
    ],
    page: 1,
    pageSize: 10,
    totalItems: 1,
    totalPages: 1,
  };
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
