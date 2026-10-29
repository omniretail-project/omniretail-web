import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { DispatchMutationCoordinator } from "@/modules/logistics/hooks/dispatchRequestIdentity";
import {
  DISPATCH_POLL_INTERVAL_MS,
  useLogisticsDispatchRead,
} from "@/modules/logistics/hooks/useLogisticsDispatchRead";
import {
  deferred,
  id,
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
  eventBus: null as unknown as DataEventBus,
  service: {
    getApiQueue: vi.fn(),
    getApiPreparedDetail: vi.fn(),
    confirmApiOrder: vi.fn(),
    confirmApiTransfer: vi.fn(),
  },
}));

vi.mock("@/infrastructure/providers/RepositoryProvider", () => ({
  useRepositories: () => mocks.repositories,
  useDataEventBus: () => mocks.eventBus,
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
    mocks.eventBus = new DataEventBus();
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

  describe("sincronizacion automatica", () => {
    const packingEvent = (overrides: { tenantId?: string; branchId?: string } = {}) => ({
      tenantId: ids.tenant,
      branchId: ids.branchA,
      packingId: ids.packing,
      ...overrides,
    });

    async function loadedHook() {
      const loadings: boolean[] = [];
      const view = renderHook(() => {
        const hook = useLogisticsDispatchRead();
        loadings.push(hook.loading);
        return hook;
      });
      await waitFor(() => expect(view.result.current.loading).toBe(false));
      loadings.length = 0;
      return { ...view, loadings };
    }

    it("un cambio de Packing actualiza la cola en segundo plano sin mostrar la carga", async () => {
      const { result, loadings } = await loadedHook();
      mocks.service.getApiQueue.mockResolvedValueOnce([queueDtos[1]!]);

      act(() => mocks.eventBus.emit("packing.changed", packingEvent()));

      await waitFor(() => expect(result.current.queue).toEqual([queueDtos[1]]));
      expect(mocks.service.getApiQueue).toHaveBeenCalledTimes(2);
      expect(loadings.every((value) => value === false)).toBe(true);
      expect(result.current.error).toBeNull();
    });

    it("los eventos dispatch.changed y order.changed tambien actualizan la cola", async () => {
      await loadedHook();

      act(() => mocks.eventBus.emit("dispatch.changed", packingEvent()));
      await waitFor(() => expect(mocks.service.getApiQueue).toHaveBeenCalledTimes(2));
      act(() => mocks.eventBus.emit("order.changed", { tenantId: ids.tenant, branchId: ids.branchA }));
      await waitFor(() => expect(mocks.service.getApiQueue).toHaveBeenCalledTimes(3));
    });

    it("ignora eventos de otra sucursal o de otro tenant", async () => {
      await loadedHook();

      act(() => mocks.eventBus.emit("packing.changed", packingEvent({ branchId: ids.branchB })));
      act(() => mocks.eventBus.emit("packing.changed", packingEvent({ tenantId: id(99) })));

      expect(mocks.service.getApiQueue).toHaveBeenCalledTimes(1);
    });

    it("no lanza consultas simultaneas: los eventos repetidos se agrupan en una sola lectura posterior", async () => {
      const { result } = await loadedHook();
      const inFlight = deferred<typeof queueDtos>();
      mocks.service.getApiQueue.mockReturnValueOnce(inFlight.promise);

      act(() => {
        mocks.eventBus.emit("packing.changed", packingEvent());
        mocks.eventBus.emit("packing.changed", packingEvent());
        mocks.eventBus.emit("packing.changed", packingEvent());
      });
      expect(mocks.service.getApiQueue).toHaveBeenCalledTimes(2);

      await act(async () => {
        inFlight.resolve(queueDtos);
        await inFlight.promise;
      });
      await waitFor(() => expect(mocks.service.getApiQueue).toHaveBeenCalledTimes(3));
      expect(result.current.loading).toBe(false);
    });

    it("una respuesta en segundo plano de otra sucursal no sobrescribe la cola vigente", async () => {
      const { result, rerender } = await loadedHook();
      const older = deferred<typeof queueDtos>();
      mocks.service.getApiQueue.mockReturnValueOnce(older.promise);
      act(() => mocks.eventBus.emit("packing.changed", packingEvent()));
      expect(mocks.service.getApiQueue).toHaveBeenCalledTimes(2);

      // La lectura en segundo plano de la sucursal A sigue en vuelo cuando el usuario cambia a B.
      mocks.branch = { currentBranch: branch(ids.branchB, "North"), loading: false };
      mocks.service.getApiQueue.mockResolvedValueOnce([queueDtos[1]!]);
      rerender();
      await waitFor(() => expect(result.current.queue).toEqual([queueDtos[1]]));

      await act(async () => {
        older.resolve(queueDtos);
        await older.promise;
      });

      expect(result.current.queue).toEqual([queueDtos[1]]);
      expect(result.current.loading).toBe(false);
    });

    it("no refresca mientras hay una confirmacion en curso y la propia mutacion recarga al terminar", async () => {
      const confirmation = deferred<typeof transferResult>();
      mocks.service.confirmApiTransfer.mockReturnValueOnce(confirmation.promise);
      const { result } = renderHook(() => useLogisticsDispatchRead());
      await waitFor(() => expect(result.current.loading).toBe(false));
      mocks.service.getApiQueue.mockClear();

      let confirming!: Promise<unknown>;
      act(() => {
        confirming = result.current.confirmTransfer(ids.transfer, "TRF-100");
      });
      await waitFor(() => expect(result.current.mutationInFlight).toBe(true));
      act(() => mocks.eventBus.emit("packing.changed", packingEvent()));
      expect(mocks.service.getApiQueue).not.toHaveBeenCalled();

      await act(async () => {
        confirmation.resolve(transferResult);
        await confirming;
      });
      expect(mocks.service.getApiQueue).toHaveBeenCalledTimes(1);
    });

    it("conserva el pedido seleccionado y su detalle durante una actualizacion", async () => {
      const { result } = await loadedHook();
      await act(async () => {
        await result.current.selectOrder(ids.order);
      });
      expect(result.current.detail).toEqual(preparedDto);

      act(() => mocks.eventBus.emit("packing.changed", packingEvent()));
      await waitFor(() => expect(mocks.service.getApiQueue).toHaveBeenCalledTimes(2));

      expect(result.current.selectedOrderId).toBe(ids.order);
      expect(result.current.detail).toEqual(preparedDto);
      expect(result.current.error).toBeNull();
    });

    it("cierra el detalle y avisa cuando el pedido seleccionado ya salio de la cola", async () => {
      const { result } = await loadedHook();
      await act(async () => {
        await result.current.selectOrder(ids.order);
      });
      mocks.service.getApiQueue.mockResolvedValueOnce([queueDtos[1]!]);

      act(() => mocks.eventBus.emit("order.changed", { tenantId: ids.tenant, branchId: ids.branchA }));

      await waitFor(() => expect(result.current.selectedOrderId).toBeNull());
      expect(result.current.detail).toBeNull();
      expect(result.current.error).toMatch(/ya no está listo/);
    });

    it("un fallo de la lectura en segundo plano conserva los datos visibles sin alertas", async () => {
      const { result } = await loadedHook();
      mocks.service.getApiQueue.mockRejectedValueOnce(new Error("Red caida"));

      act(() => mocks.eventBus.emit("packing.changed", packingEvent()));
      await waitFor(() => expect(mocks.service.getApiQueue).toHaveBeenCalledTimes(2));

      expect(result.current.queue).toEqual(queueDtos);
      expect(result.current.error).toBeNull();
      expect(result.current.loading).toBe(false);
    });

    it("programa el respaldo de 30 segundos y lo cancela al desmontar", async () => {
      expect(DISPATCH_POLL_INTERVAL_MS).toBe(30_000);
      const setIntervalSpy = vi.spyOn(window, "setInterval");
      const clearIntervalSpy = vi.spyOn(window, "clearInterval");
      try {
        const { result, unmount } = renderHook(() => useLogisticsDispatchRead());
        await waitFor(() => expect(result.current.loading).toBe(false));
        const pollingCall = setIntervalSpy.mock.calls.findIndex((call) => call[1] === DISPATCH_POLL_INTERVAL_MS);
        expect(pollingCall).toBeGreaterThanOrEqual(0);
        const timerId = setIntervalSpy.mock.results[pollingCall]!.value;

        unmount();

        expect(clearIntervalSpy).toHaveBeenCalledWith(timerId);
      } finally {
        setIntervalSpy.mockRestore();
        clearIntervalSpy.mockRestore();
      }
    });

    it("sin permiso de lectura no programa respaldo ni consulta", async () => {
      mocks.session.hasPermission.mockReturnValue(false);
      const setIntervalSpy = vi.spyOn(window, "setInterval");
      try {
        const { result } = renderHook(() => useLogisticsDispatchRead());
        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(setIntervalSpy.mock.calls.some((call) => call[1] === DISPATCH_POLL_INTERVAL_MS)).toBe(false);
        expect(mocks.service.getApiQueue).not.toHaveBeenCalled();
      } finally {
        setIntervalSpy.mockRestore();
      }
    });
  });
});
