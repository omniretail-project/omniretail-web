import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PurchaseOrdersPage } from "@/modules/purchasing/pages/PurchaseOrdersPage";

const mocks = vi.hoisted(() => ({
  usePurchaseOrders: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/infrastructure/providers/RepositoryProvider", () => ({
  useRepositories: () => ({}),
}));

vi.mock("@/shared/components/Toast", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock("@/modules/purchasing/hooks/usePurchaseOrders", () => ({
  usePurchaseOrders: mocks.usePurchaseOrders,
}));

describe("PurchaseOrdersPage in API mode", () => {
  it("keeps the search input available", () => {
    mocks.usePurchaseOrders.mockReturnValue({
      apiMode: true,
      data: { orders: [], suppliers: [], statuses: [] },
      detailOrder: null,
      filters: { search: "", status: "all", supplierId: "all" },
      paginatedOrders: [],
      totalItems: 0,
      totalPages: 0,
      page: 1,
      pageSize: 10,
      currentBranch: { id: "branch-1", tenantId: "tenant-1", name: "Central" },
      loading: false,
      error: null,
      mutationPending: false,
      canCreatePurchaseOrders: false,
      suggestions: { expanded: false, loaded: false, loading: false, items: [], toggle: vi.fn() },
      updateFilters: vi.fn(),
      setPage: vi.fn(),
      setPageSize: vi.fn(),
      loadOrderById: vi.fn(),
      updateStatus: vi.fn(),
    });

    render(<PurchaseOrdersPage />);

    expect(screen.getByRole("searchbox", { name: "Buscar ordenes" })).toBeVisible();
  });
});
