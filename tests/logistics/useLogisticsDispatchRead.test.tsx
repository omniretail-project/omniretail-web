import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import { DispatchMutationCoordinator } from "@/modules/logistics/hooks/dispatchRequestIdentity";
import { useLogisticsDispatchRead } from "@/modules/logistics/hooks/useLogisticsDispatchRead";
import {
  deferred,
  ids,
  orderResult,
  preparedDto,
  queueDtos,
  transferResult,
} from "./dispatchFixtures";

const mocks = vi.hoisted(() => ({
  repositories: {} as object,
  branch: {} as {
    currentBranch: { id: string; tenantId: string; name: string } | null;
    loading: boolean;
  },
  session: {} as {
    sessionId: string | null;
    user: { id: string; tenantId: string } | null;
    canAccessBranch: ReturnType<typeof vi.fn>;
    hasPermission: ReturnType<typeof vi.fn>;
    loading: boolean;
    error: string | null;
  },
  coordinator: null as unknown as DispatchMutationCoordinator,
  service: {
    getApiQueue: vi.fn(),
    getApiPreparedDetail: vi.fn(),
    confirmApiOrder: vi.fn(),
    confirmApiTransfer: vi.fn(),
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

vi.mock("@/modules/logistics/providers/DispatchMutationCoordinatorProvider", () => ({
  useDispatchMutationCoordinator: () => mocks.coordinator,
}));

vi.mock("@/modules/logistics/application/services/DispatchApplicationService", () => ({
  DispatchApplicationService: class {
    getApiQueue(branchId: string) {
      return mocks.service.getApiQueue(branchId);
    }

    getApiPreparedDetail(branchId: string, orderId: string) {
      return mocks.service.getApiPreparedDetail(branchId, orderId);
    }

    confirmApiOrder(branchId: string, orderId: string, command: unknown) {
      return mocks.service.confirmApiOrder(branchId, orderId, command);
    }

    confirmApiTransfer(branchId: string, transferId: string, command: unknown) {
      return mocks.service.confirmApiTransfer(branchId, transferId, command);
    }
  },
}));

function branch(id: string, name: string) {
  return { id, tenantId: ids.tenant, name };
}

describe("useLogisticsDispatchRead", () => {
  beforeEach(() => {
    mocks.repositories = {};
    mocks.branch = { currentBranch: branch(ids.branchA, "Central"), loading: false };
    mocks.session = {
      sessionId: "session-a",
      user: { id: ids.user, tenantId: ids.tenant },
      canAccessBranch: vi.fn(() => true),
      hasPermission: vi.fn(() => true),
      loading: false,
      error: null,
    };
    mocks.coordinator = new DispatchMutationCoordinator();
    mocks.service.getApiQueue.mockReset().mockResolvedValue(queueDtos);
    mocks.service.getApiPreparedDetail.mockReset().mockResolvedValue(preparedDto);
    mocks.service.confirmApiOrder.mockReset().mockResolvedValue(orderResult);
    mocks.service.confirmApiTransfer.mockReset().mockResolvedValue(transferResult);
  });

  it("loads and separates the mixed queue for an authorized branch", async () => {
    const { result } = renderHook(() => useLogisticsDispatchRead());

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mocks.service.getApiQueue).toHaveBeenCalledWith(ids.branchA);
    expect(result.current.currentBranchName).toBe("Central");
    expect(result.current.orders).toEqual([queueDtos[0]]);
    expect(result.current.transfers).toEqual([queueDtos[1]]);
    expect(result.current.error).toBeNull();
  });

  it("fails closed without read permission or branch access", async () => {
    mocks.session.hasPermission.mockReturnValue(false);
    mocks.session.canAccessBranch.mockReturnValue(false);
    const { result } = renderHook(() => useLogisticsDispatchRead());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.canRead).toBe(false);
    expect(result.current.hasBranchAccess).toBe(false);
    expect(result.current.queue).toEqual([]);
    expect(mocks.service.getApiQueue).not.toHaveBeenCalled();
  });

  it("shows queue errors and clears loading", async () => {
    mocks.service.getApiQueue.mockRejectedValueOnce(new Error("Queue unavailable"));
    const { result } = renderHook(() => useLogisticsDispatchRead());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("Queue unavailable");
    expect(result.current.queue).toEqual([]);
  });

  it("discards a late A response after switching to B", async () => {
    const requestA = deferred<typeof queueDtos>();
    mocks.service.getApiQueue.mockImplementation((branchId: string) =>
      branchId === ids.branchA ? requestA.promise : Promise.resolve([queueDtos[1]]));
    const { result, rerender } = renderHook(() => useLogisticsDispatchRead());
    await waitFor(() => expect(mocks.service.getApiQueue).toHaveBeenCalledWith(ids.branchA));

    mocks.branch = { currentBranch: branch(ids.branchB, "North"), loading: false };
    rerender();
    await waitFor(() => expect(result.current.currentBranchName).toBe("North"));
    await waitFor(() => expect(result.current.queue).toEqual([queueDtos[1]]));

    await act(async () => {
      requestA.resolve([queueDtos[0]]);
      await requestA.promise;
    });

    expect(result.current.queue).toEqual([queueDtos[1]]);
    expect(result.current.loading).toBe(false);
  });

  it("loads order detail, exposes errors and clears stale selection", async () => {
    const { result } = renderHook(() => useLogisticsDispatchRead());
    await waitFor(() => expect(result.current.loading).toBe(false));

    mocks.service.getApiPreparedDetail.mockRejectedValueOnce(new Error("Detail unavailable"));
    await act(async () => {
      await result.current.selectOrder(ids.order);
    });
    expect(result.current.selectedOrderId).toBe(ids.order);
    expect(result.current.detailLoading).toBe(false);
    expect(result.current.error).toBe("Detail unavailable");

    await act(async () => {
      await result.current.selectOrder(ids.order);
    });
    expect(result.current.detail).toEqual(preparedDto);
    expect(result.current.error).toBeNull();

    act(() => result.current.clearSelection());
    expect(result.current.selectedOrderId).toBeNull();
    expect(result.current.detail).toBeNull();
  });

  it("retains the operation id after an uncertain order failure and reuses it on retry", async () => {
    const { result } = renderHook(() => useLogisticsDispatchRead());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.selectOrder(ids.order);
    });
    mocks.service.confirmApiOrder
      .mockRejectedValueOnce(new BackendRequestError("Network", 0))
      .mockResolvedValueOnce(orderResult);

    await act(async () => {
      await result.current.confirmOrder({ carrierName: "Carrier", trackingNumber: "TRACK-1" });
    });
    expect(result.current.error).toBe("Network");
    expect(result.current.mutationInFlight).toBe(false);

    await act(async () => {
      await result.current.confirmOrder({ carrierName: "Carrier", trackingNumber: "TRACK-1" });
    });

    const firstCommand = mocks.service.confirmApiOrder.mock.calls[0]?.[2];
    const secondCommand = mocks.service.confirmApiOrder.mock.calls[1]?.[2];
    expect(secondCommand.operationId).toBe(firstCommand.operationId);
    expect(result.current.success).toContain("ORD-100");
    expect(result.current.selectedOrderId).toBeNull();
  });

  it("prevents concurrent transfer confirmations and releases the lock after settlement", async () => {
    const confirmation = deferred<typeof transferResult>();
    mocks.service.confirmApiTransfer.mockReturnValueOnce(confirmation.promise);
    const { result } = renderHook(() => useLogisticsDispatchRead());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let first!: Promise<unknown>;
    act(() => {
      first = result.current.confirmTransfer(ids.transfer, "TRF-100");
    });
    await waitFor(() => expect(result.current.mutationInFlight).toBe(true));

    await act(async () => {
      await expect(result.current.confirmTransfer(ids.transfer, "TRF-100")).resolves.toBeNull();
      confirmation.resolve(transferResult);
      await first;
    });

    expect(mocks.service.confirmApiTransfer).toHaveBeenCalledOnce();
    expect(result.current.mutationInFlight).toBe(false);
    expect(result.current.success).toContain("TRF-100");
  });
});
