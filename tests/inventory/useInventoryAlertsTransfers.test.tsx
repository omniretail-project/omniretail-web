import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InventoryTransferReason, InventoryTransferRequestStatus } from "@/core/enums";
import type {
  InventoryAlertsData,
  InventoryTransferRequestRow,
  TransferRequestDto,
} from "@/modules/inventory/application/dto/InventoryAlertsDto";
import { useInventoryAlerts } from "@/modules/inventory/hooks/useInventoryAlerts";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  approve: vi.fn(),
  create: vi.fn(),
  reject: vi.fn(),
  cancelRequest: vi.fn(),
  currentBranch: { id: "branch-a", tenantId: "tenant-1", name: "Sucursal A" },
  branches: [
    { id: "branch-a", tenantId: "tenant-1", name: "Sucursal A" },
    { id: "branch-b", tenantId: "tenant-1", name: "Sucursal B" },
  ],
  repositories: {
    inventoryStockDataSource: "api",
    inventoryTransfersDataSource: "api",
  },
}));

vi.mock("@/infrastructure/providers/RepositoryProvider", () => ({
  useRepositories: () => mocks.repositories,
}));

vi.mock("@/modules/auth/hooks/useCurrentSession", () => ({
  useCurrentSession: () => ({ hasPermission: () => true, loading: false }),
}));

vi.mock("@/shared/hooks/useEntitlement", () => ({
  useEntitlement: () => ({ hasCapability: () => true }),
}));

vi.mock("@/shared/navigation/PrivateHeader/ActiveBranchProvider", () => ({
  useActiveBranch: () => ({
    currentBranch: mocks.currentBranch,
    branches: mocks.branches,
    loading: false,
  }),
}));

vi.mock("@/shared/hooks/useDataEvent", () => ({ useDataEvent: () => undefined }));

vi.mock("@/modules/inventory/application/services/GetInventoryAlertsService", () => ({
  GetInventoryAlertsService: class {
    execute = mocks.execute;
  },
  isExpiringSoon: () => false,
}));

vi.mock("@/modules/inventory/application/services/TransferRequestServices", () => ({
  CreateTransferRequestService: class {
    execute = mocks.create;
  },
  ApproveTransferRequestService: class {
    execute = mocks.approve;
  },
  RejectTransferRequestService: class {
    execute = mocks.reject;
  },
  CancelTransferRequestService: class {
    execute = mocks.cancelRequest;
  },
}));

beforeEach(() => {
  mocks.repositories.inventoryStockDataSource = "api";
  mocks.repositories.inventoryTransfersDataSource = "api";
});

afterEach(() => vi.clearAllMocks());

describe("useInventoryAlerts transfer integration", () => {
  it("discards a late response from a previous branch and disables mutations off the active branch", async () => {
    const branchA = deferred<InventoryAlertsData>();
    mocks.execute.mockImplementation((input: { branchId: string }) =>
      input.branchId === "branch-a" ? branchA.promise : Promise.resolve(dataFor("branch-b")),
    );
    const { result } = renderHook(() => useInventoryAlerts());
    await waitFor(() => expect(mocks.execute).toHaveBeenCalledTimes(1));

    act(() => result.current.setBranchId("branch-b"));
    await waitFor(() => expect(result.current.rows[0]?.branchId).toBe("branch-b"));
    expect(result.current.canManageTransfers).toBe(false);
    await expect(result.current.requestTransfer(transferDto("branch-b"))).rejects.toThrow(
      "sucursal seleccionada debe estar activa",
    );
    expect(mocks.create).not.toHaveBeenCalled();

    await act(async () => branchA.resolve(dataFor("branch-a")));
    expect(result.current.rows[0]?.branchId).toBe("branch-b");
  });

  it("preserves mock transfer management for an authorized branch that is not active", async () => {
    mocks.repositories.inventoryStockDataSource = "mock";
    mocks.repositories.inventoryTransfersDataSource = "mock";
    mocks.execute.mockImplementation((branchId: string) => Promise.resolve(dataFor(branchId)));
    mocks.create.mockResolvedValue({ id: "request-created" });
    const { result } = renderHook(() => useInventoryAlerts());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setBranchId("branch-b"));
    await waitFor(() => expect(result.current.rows[0]?.branchId).toBe("branch-b"));
    expect(result.current.canManageTransfers).toBe(true);

    const dto = transferDto("branch-b");
    await act(async () => result.current.requestTransfer(dto));

    expect(mocks.create).toHaveBeenCalledWith(dto);
    expect(result.current.error).toBeNull();
  });

  it("allows only one transfer mutation at a time and reloads after completion", async () => {
    mocks.execute.mockResolvedValue(dataFor("branch-a"));
    const approval = deferred<{ id: string; number: string }>();
    mocks.approve.mockReturnValue(approval.promise);
    const { result } = renderHook(() => useInventoryAlerts());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.canManageTransfers).toBe(true);

    let firstApproval!: Promise<unknown>;
    act(() => {
      firstApproval = result.current.approveTransferRequest("request-1");
    });
    await expect(result.current.approveTransferRequest("request-1")).rejects.toThrow(
      "otra operacion de traslado",
    );
    expect(mocks.approve).toHaveBeenCalledTimes(1);

    await act(async () => {
      approval.resolve({ id: "transfer-1", number: "TR-1" });
      await firstApproval;
    });
    await waitFor(() => expect(mocks.execute).toHaveBeenCalledTimes(2));
    expect(result.current.busy).toBe(false);
  });

  it("refreshes visible requests after create, reject and cancel and exposes command errors", async () => {
    let nextData = dataFor("branch-a");
    mocks.execute.mockImplementation(() => Promise.resolve(nextData));
    mocks.create.mockResolvedValue({ id: "request-created" });
    mocks.reject.mockResolvedValue({ id: "request-created" });
    mocks.cancelRequest.mockResolvedValue({ id: "request-created" });
    const { result } = renderHook(() => useInventoryAlerts());
    await waitFor(() => expect(result.current.loading).toBe(false));

    nextData = dataFor("branch-a", [transferRow("request-created")]);
    await act(async () => result.current.requestTransfer(transferDto("branch-a")));
    expect(result.current.data.transferRequests.map((request) => request.id)).toEqual([
      "request-created",
    ]);

    nextData = dataFor("branch-a", []);
    await act(async () => result.current.rejectTransferRequest("request-created", "Sin stock"));
    expect(mocks.reject).toHaveBeenCalledWith("request-created", "Sin stock");
    expect(result.current.data.transferRequests).toEqual([]);

    nextData = dataFor("branch-a", [transferRow("request-to-cancel")]);
    await act(async () => result.current.reload());
    nextData = dataFor("branch-a", []);
    await act(async () => result.current.cancelTransferRequest("request-to-cancel"));
    expect(mocks.cancelRequest).toHaveBeenCalledWith("request-to-cancel");
    expect(result.current.data.transferRequests).toEqual([]);

    mocks.cancelRequest.mockRejectedValueOnce(new Error("Red no disponible"));
    await act(async () => {
      await expect(result.current.cancelTransferRequest("request-error")).rejects.toThrow(
        "Red no disponible",
      );
    });
    expect(result.current.error).toBe("Red no disponible");
    expect(result.current.busy).toBe(false);
  });
});

function dataFor(
  branchId: string,
  transferRequests: InventoryTransferRequestRow[] = [],
): InventoryAlertsData {
  return {
    supportsMultipleLocations: true,
    rows: [
      {
        productId: "product-1",
        tenantId: "tenant-1",
        productName: "Taladro",
        sku: "TAL-1",
        productType: "physical",
        inventoryMode: "TRACKED",
        displayStatus: "NORMAL",
        categoryId: "category-1",
        categoryName: "Herramientas",
        unitId: "unit-1",
        unitName: "Unidad",
        unitAllowsDecimals: false,
        saleUnitId: "unit-1",
        saleUnitName: "Unidad",
        sellableQuantity: 5,
        sellableReservedQuantity: 0,
        sellableAvailableQuantity: 5,
        inventoryUnitId: "unit-1",
        inventoryUnitName: "Unidad",
        inventoryPresentationQuantity: 5,
        inventoryPresentationAvailableQuantity: 5,
        inventoryToBaseFactor: 1,
        adjustmentUnits: [],
        branchId,
        branchName: branchId,
        defaultLocationName: "Principal",
        locationQuantities: {},
        locationAvailableQuantities: {},
        unlocatedQuantity: 0,
        unlocatedAvailableQuantity: 0,
        tracking: { stock: true, lot: false, expiration: false, serial: false },
        availableLots: [],
        availableSerials: [],
        quantity: 5,
        reservedQuantity: 0,
        availableQuantity: 5,
        minStock: 1,
        status: "normal",
        statusLabel: "Normal",
        tracksExpiration: false,
        nextExpirationLabel: "-",
        activeAlerts: [],
        otherBranchStocks: [],
        isDerivedKit: false,
      },
    ],
    alerts: [],
    alertTotalItems: 0,
    transferRequests,
    kpis: { activeProducts: 1, lowStock: 0, expiringSoon: 0, outOfStock: 0 },
    visibility: {
      supportsExpiration: false,
      hasExpirationProducts: false,
      showExpirationFeatures: false,
    },
    branches: [],
    categories: [],
    locations: [],
    page: 1,
    pageSize: 20,
    totalItems: 1,
    totalPages: 1,
  };
}

function transferDto(requesterBranchId: string): TransferRequestDto {
  return {
    productId: "product-1",
    requesterBranchId,
    providerBranchId: requesterBranchId === "branch-a" ? "branch-b" : "branch-a",
    quantity: 2,
    reason: InventoryTransferReason.replenishment,
    notes: "Reposicion",
  };
}

function transferRow(id: string): InventoryTransferRequestRow {
  return {
    id,
    context: "received",
    productId: "product-1",
    productName: "Taladro",
    sku: "TAL-1",
    requestingBranchId: "branch-b",
    requestingBranchName: "Sucursal B",
    sourceBranchId: "branch-a",
    sourceBranchName: "Sucursal A",
    requestedQuantity: 2,
    availableQuantity: 5,
    reason: InventoryTransferReason.replenishment,
    status: InventoryTransferRequestStatus.requested,
    requestedAt: "2026-10-13T12:00:00.000Z",
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
