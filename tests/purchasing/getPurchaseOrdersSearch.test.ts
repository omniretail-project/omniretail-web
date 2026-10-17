import { describe, expect, it, vi } from "vitest";
import { PurchaseOrderStatus } from "@/core/enums";
import { GetPurchaseOrdersReadModelService } from "@/modules/purchasing/application/services/GetPurchaseOrdersReadModelService";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";

const context = vi.hoisted(() => ({
  resolve: vi.fn(),
  ensureRead: vi.fn(),
}));

vi.mock("@/modules/purchasing/application/services/serviceHelpers", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("@/modules/purchasing/application/services/serviceHelpers")
    >();
  return {
    ...original,
    resolvePurchasingContext: context.resolve,
    ensureCanReadPurchaseOrders: context.ensureRead,
  };
});

describe("GetPurchaseOrdersReadModelService search", () => {
  it("forwards search to the API repository with the existing paging filters", async () => {
    const getPageScoped = vi.fn().mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 10,
      totalItems: 0,
      totalPages: 0,
    });
    context.resolve.mockResolvedValue({
      tenantId: "tenant-1",
      permissions: ["purchasing.orders.read"],
    });
    const repositories = {
      purchaseOrdersDataSource: "api",
      purchaseOrders: { getPageScoped },
      suppliers: { getActiveByTenant: vi.fn().mockResolvedValue([]) },
    } as unknown as RepositoryRegistry;

    await new GetPurchaseOrdersReadModelService(repositories).execute({
      branchId: "branch-1",
      branchName: "Central",
      supplierId: "supplier-1",
      status: PurchaseOrderStatus.approved,
      search: "martillo",
      page: 1,
      pageSize: 10,
    });

    expect(getPageScoped).toHaveBeenCalledWith("tenant-1", {
      branchId: "branch-1",
      supplierId: "supplier-1",
      status: PurchaseOrderStatus.approved,
      search: "martillo",
      page: 1,
      pageSize: 10,
    });
  });
});
