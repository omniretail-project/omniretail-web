import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import type { ReceivingDocumentDetail } from "@/modules/receiving/application/dto/ReceivingDocumentDetailDto";
import { useReceivingDocumentDetail } from "@/modules/receiving/hooks/useReceivingDocumentDetail";
import { ReceivingMutationCoordinatorProvider } from "@/modules/receiving/providers/ReceivingMutationCoordinatorProvider";
import { capabilityFlags, receivingLine } from "./receivingFixtures";
import { disableBrowserLocks, installBrowserLocksHarness } from "./browserLocksTestHarness";

const mocks = vi.hoisted(() => ({
  repositories: { receivingDataSource: "api" },
  branch: { currentBranch: { id: "branch-a", name: "Sucursal A" }, loading: false },
  session: {
    sessionId: "session-1",
    user: { id: "user-1", tenantId: "tenant-1" },
  },
  service: {
    getDocument: vi.fn(),
    confirm: vi.fn(),
    saveProgress: vi.fn(),
  },
}));

vi.mock("@/infrastructure/providers/RepositoryProvider", () => ({
  useRepositories: () => mocks.repositories,
}));

vi.mock("@/modules/auth/hooks/useCurrentSession", () => ({
  useCurrentSession: () => mocks.session,
}));

vi.mock("@/shared/navigation/PrivateHeader/ActiveBranchProvider", () => ({
  useActiveBranch: () => mocks.branch,
}));

vi.mock("@/shared/hooks/useDataEvent", () => ({ useDataEvent: () => undefined }));

vi.mock("@/modules/purchasing/application/services/PurchaseOrderPdfService", () => ({
  PurchaseOrderPdfService: class {
    downloadReceivingReport = vi.fn();
  },
}));

vi.mock(
  "@/modules/receiving/application/services/ReceivingDocumentDetailService",
  async (importOriginal) => {
    const actual = await importOriginal<
      typeof import("@/modules/receiving/application/services/ReceivingDocumentDetailService")
    >();
    return {
      ...actual,
      ReceivingDocumentDetailService: class {
        getDocument = mocks.service.getDocument;
        confirm = mocks.service.confirm;
        saveProgress = mocks.service.saveProgress;
      },
    };
  },
);

function transferDetail(
  branchId = "branch-a",
  locationId = "location-1",
  number = "TR-001",
): ReceivingDocumentDetail {
  const line = receivingLine({
    id: "item-1",
    sourceLineId: "item-1",
    productId: "product-1",
    unitAllowsDecimals: true,
    baseUnitAllowsDecimals: true,
    receivedNow: 0,
    pendingQuantity: 5,
    orderedQuantity: 5,
    locationId,
  });
  return {
    document: {
      id: "transfer-1",
      type: "transfer",
      number,
      typeLabel: "Traslado",
      originLabel: "Sucursal origen",
      originName: "Origen",
      branchId,
      branchName: branchId,
      tenantId: "tenant-1",
      statusLabel: "En tránsito",
    },
    lines: [line],
    locations: [{ id: locationId, code: "A-01", name: "Estante A" }],
    incidentTypes: [],
    incidents: [],
    previousReceipts: [],
    capabilities: capabilityFlags(),
    dataSource: "api",
    canConfirm: true,
    canManageIncidents: false,
    readOnly: false,
    transferReception: {
      requiresSingleDestinationLocation: true,
      canReceiveTransfer: true,
      canConfirmTransfer: false,
      blockedLineIds: [],
      traceabilityBlockedLineIds: [],
      unavailableProductLineIds: [],
      blockingReason: "Selecciona al menos una cantidad para recibir.",
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function wrapper({ children }: { children: ReactNode }) {
  return <ReceivingMutationCoordinatorProvider>{children}</ReceivingMutationCoordinatorProvider>;
}

describe("useReceivingDocumentDetail transfer API", () => {
  beforeEach(() => {
    window.localStorage.clear();
    installBrowserLocksHarness();
    mocks.session = {
      sessionId: "session-1",
      user: { id: "user-1", tenantId: "tenant-1" },
    };
    mocks.branch = { currentBranch: { id: "branch-a", name: "Sucursal A" }, loading: false };
    mocks.service.getDocument.mockReset().mockResolvedValue(transferDetail());
    mocks.service.confirm.mockReset().mockResolvedValue({ id: "receipt-1" });
    mocks.service.saveProgress.mockReset();
  });

  it("enables a partial selection and reuses its confirmation id after an uncertain failure", async () => {
    mocks.service.confirm
      .mockRejectedValueOnce(new BackendRequestError("Network", 0))
      .mockResolvedValueOnce({ id: "receipt-1" });
    const first = renderHook(() => useReceivingDocumentDetail("transfer", "transfer-1"), {
      wrapper,
    });
    const { result } = first;
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.updateLineQuantity("item-1", 2.5));
    expect(result.current.transferReception).toMatchObject({
      canConfirmTransfer: true,
      destinationLocationId: "location-1",
    });

    await act(async () => {
      await expect(result.current.confirm()).rejects.toThrow("Network");
    });
    expect(result.current.saving).toBe(false);
    first.unmount();

    const reloaded = renderHook(() => useReceivingDocumentDetail("transfer", "transfer-1"), {
      wrapper,
    });
    await waitFor(() => expect(reloaded.result.current.pendingTransferRetryReady).toBe(true));
    expect(reloaded.result.current.lines[0]?.receivedNow).toBe(2.5);

    await act(async () => { await reloaded.result.current.confirm(); });

    const firstId = mocks.service.confirm.mock.calls[0]?.[0].confirmationId;
    const secondId = mocks.service.confirm.mock.calls[1]?.[0].confirmationId;
    expect(secondId).toBe(firstId);
    expect(mocks.service.confirm.mock.calls[1]?.[0].transferOperation).toEqual({
      destinationLocationId: "location-1",
      idempotentReplay: true,
    });
    expect(reloaded.result.current.hasPendingTransferConfirmation).toBe(false);
  });

  it("does not let two independent provider trees confirm the same transfer simultaneously", async () => {
    const pendingConfirmation = deferred<{ id: string }>();
    mocks.service.confirm.mockImplementationOnce(() => pendingConfirmation.promise);
    const firstTab = renderHook(
      () => useReceivingDocumentDetail("transfer", "transfer-1"),
      { wrapper },
    );
    const secondTab = renderHook(
      () => useReceivingDocumentDetail("transfer", "transfer-1"),
      { wrapper },
    );
    await waitFor(() => {
      expect(firstTab.result.current.loading).toBe(false);
      expect(secondTab.result.current.loading).toBe(false);
    });
    act(() => firstTab.result.current.updateLineQuantity("item-1", 1));
    act(() => secondTab.result.current.updateLineQuantity("item-1", 1));

    let firstConfirmation!: Promise<void>;
    act(() => {
      firstConfirmation = firstTab.result.current.confirm();
    });
    await waitFor(() => expect(mocks.service.confirm).toHaveBeenCalledTimes(1));
    await act(async () => {
      await expect(secondTab.result.current.confirm()).rejects.toThrow(/otra pestaña/i);
    });
    expect(mocks.service.confirm).toHaveBeenCalledTimes(1);

    pendingConfirmation.resolve({ id: "receipt-1" });
    await act(async () => { await firstConfirmation; });
  });

  it("blocks before calling the service when Web Locks is unavailable", async () => {
    disableBrowserLocks();
    const { result } = renderHook(
      () => useReceivingDocumentDetail("transfer", "transfer-1"),
      { wrapper },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.updateLineQuantity("item-1", 1));

    await act(async () => {
      await expect(result.current.confirm()).rejects.toThrow(/coordinación segura/i);
    });
    expect(mocks.service.confirm).not.toHaveBeenCalled();
  });

  it("retries the original location when the operational setting changes after an uncertain result", async () => {
    mocks.service.confirm
      .mockRejectedValueOnce(new BackendRequestError("Network", 0))
      .mockResolvedValueOnce({ id: "receipt-1" });
    const first = renderHook(() => useReceivingDocumentDetail("transfer", "transfer-1"), {
      wrapper,
    });
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    act(() => first.result.current.updateLineQuantity("item-1", 2));
    await act(async () => {
      await expect(first.result.current.confirm()).rejects.toThrow("Network");
    });
    first.unmount();

    mocks.service.getDocument.mockResolvedValue(transferDetail("branch-a", "location-2"));
    const reloaded = renderHook(() => useReceivingDocumentDetail("transfer", "transfer-1"), {
      wrapper,
    });
    await waitFor(() => expect(reloaded.result.current.pendingTransferRetryReady).toBe(true));
    await act(async () => { await reloaded.result.current.confirm(); });

    expect(mocks.service.confirm).toHaveBeenCalledTimes(2);
    expect(mocks.service.confirm.mock.calls[1]?.[0]).toMatchObject({
      confirmationId: mocks.service.confirm.mock.calls[0]?.[0].confirmationId,
      transferOperation: {
        destinationLocationId: "location-1",
        idempotentReplay: true,
      },
    });
  });

  it("blocks a changed quantity while the original result remains uncertain", async () => {
    mocks.service.confirm.mockRejectedValue(new BackendRequestError("Network", 0));
    const { result } = renderHook(() => useReceivingDocumentDetail("transfer", "transfer-1"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.updateLineQuantity("item-1", 1));
    await act(async () => { await expect(result.current.confirm()).rejects.toThrow("Network"); });
    act(() => result.current.updateLineQuantity("item-1", 2));
    await act(async () => {
      await expect(result.current.confirm()).rejects.toThrow(/cantidades originales/i);
    });

    expect(mocks.service.confirm).toHaveBeenCalledTimes(1);
  });

  it("clears a first definitive rejection and allows a new operation identity", async () => {
    mocks.service.confirm
      .mockRejectedValueOnce(new BackendRequestError("Invalid", 400))
      .mockResolvedValueOnce({ id: "receipt-1" });
    const { result } = renderHook(() => useReceivingDocumentDetail("transfer", "transfer-1"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.updateLineQuantity("item-1", 1));
    await act(async () => { await expect(result.current.confirm()).rejects.toThrow("Invalid"); });
    expect(result.current.hasPendingTransferConfirmation).toBe(false);
    act(() => result.current.updateLineQuantity("item-1", 2));
    await act(async () => { await result.current.confirm(); });

    expect(mocks.service.confirm.mock.calls[1]?.[0].confirmationId)
      .not.toBe(mocks.service.confirm.mock.calls[0]?.[0].confirmationId);
  });

  it("blocks a new session from replacing an uncertain operation", async () => {
    mocks.service.confirm.mockRejectedValue(new BackendRequestError("Network", 0));
    const first = renderHook(() => useReceivingDocumentDetail("transfer", "transfer-1"), {
      wrapper,
    });
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    act(() => first.result.current.updateLineQuantity("item-1", 1));
    await act(async () => {
      await expect(first.result.current.confirm()).rejects.toThrow("Network");
    });
    first.unmount();

    mocks.session = {
      sessionId: "session-2",
      user: { id: "user-1", tenantId: "tenant-1" },
    };
    const nextSession = renderHook(
      () => useReceivingDocumentDetail("transfer", "transfer-1"),
      { wrapper },
    );
    await waitFor(() => expect(nextSession.result.current.loading).toBe(false));

    expect(nextSession.result.current.pendingTransferMessage).toMatch(/otra sesión/i);
    await act(async () => {
      await expect(nextSession.result.current.confirm()).rejects.toThrow(/otra sesión/i);
    });
    expect(mocks.service.confirm).toHaveBeenCalledTimes(1);
  });

  it("allows selecting the total pending quantity", async () => {
    const { result } = renderHook(() => useReceivingDocumentDetail("transfer", "transfer-1"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.updateLineQuantity("item-1", 5));

    expect(result.current.transferReception?.canConfirmTransfer).toBe(true);
  });

  it("discards a late detail response after the active branch changes", async () => {
    const branchA = deferred<ReceivingDocumentDetail>();
    mocks.service.getDocument.mockImplementation(
      (_type: string, _id: string, branchId: string) =>
        branchId === "branch-a" ? branchA.promise : Promise.resolve(transferDetail("branch-b")),
    );
    const { result, rerender } = renderHook(
      () => useReceivingDocumentDetail("transfer", "transfer-1"),
      { wrapper },
    );
    await waitFor(() => expect(mocks.service.getDocument).toHaveBeenCalledWith(
      "transfer",
      "transfer-1",
      "branch-a",
    ));

    mocks.branch = {
      currentBranch: { id: "branch-b", name: "Sucursal B" },
      loading: false,
    };
    rerender();
    await waitFor(() => expect(result.current.detail?.document.branchId).toBe("branch-b"));

    await act(async () => {
      branchA.resolve(transferDetail("branch-a"));
      await branchA.promise;
    });

    expect(result.current.detail?.document.branchId).toBe("branch-b");
    expect(result.current.loading).toBe(false);
  });

  it("does not revive the first A response after navigating A to B to A", async () => {
    const firstA = deferred<ReceivingDocumentDetail>();
    let aRequests = 0;
    mocks.service.getDocument.mockImplementation(
      (_type: string, _id: string, branchId: string) => {
        if (branchId === "branch-b") return Promise.resolve(transferDetail("branch-b"));
        aRequests += 1;
        return aRequests === 1
          ? firstA.promise
          : Promise.resolve(transferDetail("branch-a", "location-1", "TR-A-NEW"));
      },
    );
    const { result, rerender } = renderHook(
      () => useReceivingDocumentDetail("transfer", "transfer-1"),
      { wrapper },
    );
    await waitFor(() => expect(aRequests).toBe(1));

    mocks.branch = {
      currentBranch: { id: "branch-b", name: "Sucursal B" },
      loading: false,
    };
    rerender();
    await waitFor(() => expect(result.current.detail?.document.branchId).toBe("branch-b"));
    mocks.branch = {
      currentBranch: { id: "branch-a", name: "Sucursal A" },
      loading: false,
    };
    rerender();
    await waitFor(() => expect(result.current.detail?.document.number).toBe("TR-A-NEW"));

    await act(async () => {
      firstA.resolve(transferDetail("branch-a", "location-1", "TR-A-OLD"));
      await firstA.promise;
    });

    expect(result.current.detail?.document.number).toBe("TR-A-NEW");
  });
});
