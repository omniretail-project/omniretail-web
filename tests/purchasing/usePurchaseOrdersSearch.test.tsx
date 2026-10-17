import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePurchaseOrders } from "@/modules/purchasing/hooks/usePurchaseOrders";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  repositories: {} as Record<string, unknown>,
}));

vi.mock("@/infrastructure/providers/RepositoryProvider", () => ({
  useRepositories: () => mocks.repositories,
}));

vi.mock("@/modules/auth/hooks/useCurrentSession", () => ({
  useCurrentSession: () => ({ hasPermission: () => true }),
}));

vi.mock("@/shared/hooks/useEntitlement", () => ({
  useEntitlement: () => ({ hasCapability: () => true }),
}));

vi.mock("@/shared/navigation/PrivateHeader/ActiveBranchProvider", () => ({
  useActiveBranch: () => ({
    currentBranch: { id: "branch-1", tenantId: "tenant-1", name: "Central" },
    loading: false,
  }),
}));

vi.mock("@/shared/hooks/useDataEvent", () => ({ useDataEvent: () => undefined }));

vi.mock("@/modules/purchasing/application/services/GetPurchaseOrdersReadModelService", () => ({
  GetPurchaseOrdersReadModelService: class {
    execute = mocks.execute;
    loadReorderSuggestions = vi.fn();
    getById = vi.fn();
  },
}));

vi.mock("@/modules/purchasing/application/services/UpdatePurchaseOrderStatusService", () => ({
  UpdatePurchaseOrderStatusService: class {
    execute = vi.fn();
  },
}));

afterEach(() => vi.clearAllMocks());

describe("usePurchaseOrders search in API mode", () => {
  it("reloads the first page with the server-side search term", async () => {
    mocks.repositories = { purchaseOrdersDataSource: "api" };
    mocks.execute.mockResolvedValue(readModel());

    const { result } = renderHook(() => usePurchaseOrders());

    await waitFor(() => expect(mocks.execute).toHaveBeenCalledTimes(1));
    expect(mocks.execute).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: "", page: 1, pageSize: 10 }),
    );

    act(() => result.current.updateFilters({ search: "taladro" }));

    await waitFor(() =>
      expect(mocks.execute).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: "taladro", page: 1, pageSize: 10 }),
      ),
    );
  });
});

function readModel() {
  return {
    orders: [],
    suppliers: [],
    statuses: [],
    suggestions: [],
    page: 1,
    pageSize: 10,
    totalItems: 0,
    totalPages: 0,
  };
}
