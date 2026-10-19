import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeliveryMethod, OrderStatus } from "@/core/enums";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import type {
  LogisticsHistoryDetailDto,
  LogisticsHistoryItemDto,
} from "@/modules/logistics/application/dto/LogisticsHistoryDto";
import { DispatchMutationCoordinator } from "@/modules/logistics/hooks/dispatchRequestIdentity";
import {
  isStorePickupHandoverEligible,
  useLogisticsHistory,
} from "@/modules/logistics/hooks/useLogisticsHistory";

const mocks = vi.hoisted(() => ({
  branch: {
    currentBranch: { id: "branch-a", tenantId: "tenant-a", name: "Centro" } as {
      id: string;
      tenantId: string;
      name: string;
    } | null,
    loading: false,
  },
  session: {
    sessionId: "session-a" as string | null,
    user: { id: "user-a", tenantId: "tenant-a" } as {
      id: string;
      tenantId: string;
    } | null,
    permissions: new Set<string>(),
    branchAccess: true,
    loading: false,
    error: null as string | null,
  },
  repositories: {},
  coordinator: null as DispatchMutationCoordinator | null,
  searchApi: vi.fn(),
  getApiDetail: vi.fn(),
  confirmHandover: vi.fn(),
}));

vi.mock("@/infrastructure/providers/RepositoryProvider", () => ({
  useRepositories: () => mocks.repositories,
}));
vi.mock("@/modules/auth/hooks/useCurrentSession", () => ({
  useCurrentSession: () => ({
    ...mocks.session,
    canAccessBranch: () => mocks.session.branchAccess,
    hasPermission: (permission: string) => mocks.session.permissions.has(permission),
  }),
}));
vi.mock("@/shared/navigation/PrivateHeader/ActiveBranchProvider", () => ({
  useActiveBranch: () => mocks.branch,
}));
vi.mock("@/shared/hooks/useDataEvent", () => ({ useDataEvent: () => undefined }));
vi.mock("@/modules/logistics/providers/DispatchMutationCoordinatorProvider", () => ({
  useDispatchMutationCoordinator: () => mocks.coordinator,
}));
vi.mock("@/modules/logistics/application/services/DispatchApplicationService", () => ({
  DispatchApplicationService: class {},
}));
vi.mock("@/modules/logistics/application/services/GetLogisticsHistoryService", () => ({
  GetLogisticsHistoryService: class {
    get usesApi() {
      return true;
    }
    searchApi(branchId: string, query: unknown) {
      return mocks.searchApi(branchId, query);
    }
    getApiDetail(branchId: string, item: LogisticsHistoryItemDto) {
      return mocks.getApiDetail(branchId, item);
    }
  },
}));
vi.mock(
  "@/modules/logistics/application/services/StorePickupHandoverApplicationService",
  () => ({
    StorePickupHandoverApplicationService: class {
      confirm(branchId: string, orderId: string) {
        return mocks.confirmHandover(branchId, orderId);
      }
    },
  }),
);

function historyItem(
  orderId: string,
  overrides: Partial<LogisticsHistoryItemDto> = {},
): LogisticsHistoryItemDto {
  return {
    sourceType: "order",
    sourceId: orderId,
    orderId,
    orderReference: `POS-${orderId}`,
    deliveryMethod: DeliveryMethod.store_pickup,
    operationalStatus: OrderStatus.ready_for_pickup,
    contactName: "Cliente",
    contactPhone: null,
    pickingOrderId: "picking-a",
    packingId: "packing-a",
    dispatchId: null,
    storePickupDeliveryId: null,
    pickingCompletedAt: "2026-10-18T12:00:00Z",
    packingFinalizedAt: "2026-10-18T13:00:00Z",
    dispatchedAt: null,
    deliveredAt: null,
    responsibleUserId: null,
    responsibleUserName: null,
    totalWeight: 1,
    packageCount: 1,
    dispatchStatus: null,
    carrierName: null,
    trackingNumber: null,
    ...overrides,
  };
}

function detail(item: LogisticsHistoryItemDto): LogisticsHistoryDetailDto {
  return { summary: item, items: [] };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const successfulResult = {
  orderId: "order-a",
  status: "delivered" as const,
  deliveredAt: "2026-10-18T16:30:00-06:00",
  idempotent: false,
};

async function renderHistoryWithDetail(item = historyItem("order-a")) {
  mocks.getApiDetail.mockResolvedValue(detail(item));
  const view = renderHook(() => useLogisticsHistory());
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  await act(async () => {
    await view.result.current.openDetail(item);
  });
  return view;
}

describe("store-pickup handover eligibility", () => {
  const eligible = historyItem("order-a");

  it("acepta exclusivamente pedidos store_pickup listos y aun no entregados", () => {
    expect(isStorePickupHandoverEligible(eligible)).toBe(true);
    expect(isStorePickupHandoverEligible(null)).toBe(false);
    expect(isStorePickupHandoverEligible({ ...eligible, sourceType: "transfer" })).toBe(false);
    expect(isStorePickupHandoverEligible({
      ...eligible,
      deliveryMethod: DeliveryMethod.home_delivery,
    })).toBe(false);
    expect(isStorePickupHandoverEligible({
      ...eligible,
      operationalStatus: OrderStatus.delivered,
    })).toBe(false);
    expect(isStorePickupHandoverEligible({
      ...eligible,
      deliveredAt: "2026-10-18T16:30:00-06:00",
    })).toBe(false);
    expect(isStorePickupHandoverEligible({
      ...eligible,
      storePickupDeliveryId: "delivery-a",
    })).toBe(false);
  });
});

describe("useLogisticsHistory store-pickup handover", () => {
  beforeEach(() => {
    mocks.branch = {
      currentBranch: { id: "branch-a", tenantId: "tenant-a", name: "Centro" },
      loading: false,
    };
    mocks.session = {
      sessionId: "session-a",
      user: { id: "user-a", tenantId: "tenant-a" },
      permissions: new Set(["logistics.history.read", "logistics.dispatch.confirm"]),
      branchAccess: true,
      loading: false,
      error: null,
    };
    mocks.coordinator = new DispatchMutationCoordinator();
    mocks.searchApi.mockResolvedValue({
      items: [historyItem("order-a")],
      page: 1,
      pageSize: 10,
      totalItems: 1,
      totalPages: 1,
    });
    mocks.getApiDetail.mockResolvedValue(detail(historyItem("order-a")));
    mocks.confirmHandover.mockResolvedValue(successfulResult);
  });

  it("expone la accion elegible sin exigir logistics.dispatch.read", async () => {
    const view = await renderHistoryWithDetail();

    expect(view.result.current.canConfirmStorePickupHandover).toBe(true);
    expect(view.result.current.canConfirmDispatch).toBe(false);
    expect(view.result.current.storePickupHandoverEligible).toBe(true);

    await act(async () => {
      await view.result.current.confirmStorePickupHandover("order-a");
    });
    expect(mocks.confirmHandover).toHaveBeenCalledWith("branch-a", "order-a");
  });

  it("no ejecuta el comando para un pedido no elegible o sin permiso", async () => {
    const ineligible = historyItem("order-a", {
      operationalStatus: OrderStatus.delivered,
      deliveredAt: "2026-10-18T16:30:00-06:00",
    });
    const view = await renderHistoryWithDetail(ineligible);

    expect(view.result.current.storePickupHandoverEligible).toBe(false);
    await act(async () => {
      await view.result.current.confirmStorePickupHandover("order-a");
    });
    expect(mocks.confirmHandover).not.toHaveBeenCalled();

    mocks.session.permissions.delete("logistics.dispatch.confirm");
    await act(async () => {
      view.rerender();
      await Promise.resolve();
    });
    expect(view.result.current.canConfirmStorePickupHandover).toBe(false);

    mocks.session.permissions.add("logistics.dispatch.confirm");
    mocks.session.branchAccess = false;
    await act(async () => {
      view.rerender();
      await Promise.resolve();
    });
    expect(view.result.current.canConfirmStorePickupHandover).toBe(false);
  });

  it.each([false, true])(
    "refresca lista y detalle despues de un resultado idempotent=%s",
    async (idempotent) => {
      mocks.confirmHandover.mockResolvedValue({ ...successfulResult, idempotent });
      const view = await renderHistoryWithDetail();
      const listCallsBefore = mocks.searchApi.mock.calls.length;
      const detailCallsBefore = mocks.getApiDetail.mock.calls.length;

      await act(async () => {
        await view.result.current.confirmStorePickupHandover("order-a");
      });

      expect(mocks.searchApi.mock.calls.length).toBeGreaterThan(listCallsBefore);
      expect(mocks.getApiDetail.mock.calls.length).toBeGreaterThan(detailCallsBefore);
      expect(view.result.current.storePickupHandoverSubmitting).toBe(false);
      expect(view.result.current.storePickupHandoverError).toBeNull();
    },
  );

  it("mantiene el detalle autoritativo y permite releer si falla el refresco de lista", async () => {
    const view = await renderHistoryWithDetail();
    const detailCallsBefore = mocks.getApiDetail.mock.calls.length;
    mocks.searchApi.mockRejectedValueOnce(new Error("No se pudo refrescar la lista"));

    await act(async () => {
      await view.result.current.confirmStorePickupHandover("order-a");
    });

    expect(view.result.current.error).toBe("No se pudo refrescar la lista");
    expect(mocks.getApiDetail.mock.calls.length).toBeGreaterThan(detailCallsBefore);
    expect(mocks.coordinator?.isRequestInFlight()).toBe(false);

    await act(async () => {
      await view.result.current.reload();
    });
    expect(view.result.current.error).toBeNull();
  });

  it("evita dos POST antes de que React publique el estado de envio", async () => {
    const pending = deferred<typeof successfulResult>();
    mocks.confirmHandover.mockReturnValue(pending.promise);
    const view = await renderHistoryWithDetail();
    let first!: Promise<unknown>;
    let second!: Promise<unknown>;

    act(() => {
      first = view.result.current.confirmStorePickupHandover("order-a");
      second = view.result.current.confirmStorePickupHandover("order-a");
    });

    expect(mocks.confirmHandover).toHaveBeenCalledTimes(1);
    await expect(second).resolves.toBeNull();
    await act(async () => {
      pending.resolve(successfulResult);
      await first;
    });
  });

  it.each<[BackendRequestError, boolean]>([
    [new BackendRequestError("Conflicto de estado", 409, "PICKUP_STATE_CONFLICT"), false],
    [new BackendRequestError("No fue posible verificar la entrega", 0), true],
  ])("libera el bloqueo y permite reintentar despues de %#", async (failure, uncertain) => {
    mocks.confirmHandover.mockRejectedValueOnce(failure);
    const view = await renderHistoryWithDetail();

    await act(async () => {
      await view.result.current.confirmStorePickupHandover("order-a");
    });
    expect(view.result.current.storePickupHandoverError).toBe(failure.message);
    expect(view.result.current.storePickupHandoverErrorUncertain).toBe(uncertain);
    expect(mocks.coordinator?.isRequestInFlight()).toBe(false);

    await act(async () => {
      await view.result.current.confirmStorePickupHandover("order-a");
    });
    expect(mocks.confirmHandover).toHaveBeenCalledTimes(2);
  });

  it.each(["session", "user", "tenant", "branch"])(
    "una respuesta tardia no publica estado tras cambiar %s",
    async (changedField) => {
      const pending = deferred<typeof successfulResult>();
      mocks.confirmHandover.mockReturnValue(pending.promise);
      const view = await renderHistoryWithDetail();
      let request!: Promise<unknown>;
      act(() => {
        request = view.result.current.confirmStorePickupHandover("order-a");
      });

      if (changedField === "branch") {
        mocks.branch = {
          currentBranch: { id: "branch-b", tenantId: "tenant-a", name: "Norte" },
          loading: false,
        };
      } else {
        mocks.session = {
          ...mocks.session,
          sessionId: changedField === "session" ? "session-b" : mocks.session.sessionId,
          user: {
            id: changedField === "user" ? "user-b" : "user-a",
            tenantId: changedField === "tenant" ? "tenant-b" : "tenant-a",
          },
        };
        mocks.coordinator = new DispatchMutationCoordinator();
      }
      await act(async () => {
        view.rerender();
        await Promise.resolve();
      });
      await act(async () => {
        pending.resolve(successfulResult);
        await request;
      });

      expect(view.result.current.storePickupHandoverError).toBeNull();
      expect(view.result.current.storePickupHandoverSubmitting).toBe(false);
    },
  );

  it("cerrar el detalle invalida la respuesta sin impedir liberar el token propietario", async () => {
    const pending = deferred<typeof successfulResult>();
    mocks.confirmHandover.mockReturnValue(pending.promise);
    const view = await renderHistoryWithDetail();
    let request!: Promise<unknown>;
    act(() => {
      request = view.result.current.confirmStorePickupHandover("order-a");
    });
    act(() => view.result.current.closeDetail());

    await act(async () => {
      pending.resolve(successfulResult);
      await request;
    });

    expect(view.result.current.detailOpen).toBe(false);
    expect(view.result.current.storePickupHandoverError).toBeNull();
    expect(mocks.coordinator?.isRequestInFlight()).toBe(false);
  });

  it("un cambio de pedido invalida la respuesta del pedido anterior", async () => {
    const pending = deferred<typeof successfulResult>();
    mocks.confirmHandover.mockReturnValue(pending.promise);
    const orderA = historyItem("order-a");
    const orderB = historyItem("order-b");
    const view = await renderHistoryWithDetail(orderA);
    let request!: Promise<unknown>;
    act(() => {
      request = view.result.current.confirmStorePickupHandover("order-a");
    });
    mocks.getApiDetail.mockResolvedValue(detail(orderB));
    await act(async () => {
      await view.result.current.openDetail(orderB);
    });

    await act(async () => {
      pending.resolve(successfulResult);
      await request;
    });
    expect(view.result.current.detail?.summary.orderId).toBe("order-b");
    expect(view.result.current.storePickupHandoverError).toBeNull();
  });

  it("A -> B -> A no reactiva la respuesta de la primera visita", async () => {
    const pending = deferred<typeof successfulResult>();
    mocks.confirmHandover.mockReturnValueOnce(pending.promise);
    const orderA = historyItem("order-a");
    const view = await renderHistoryWithDetail(orderA);
    let oldRequest!: Promise<unknown>;
    act(() => {
      oldRequest = view.result.current.confirmStorePickupHandover("order-a");
    });

    mocks.branch = {
      currentBranch: { id: "branch-b", tenantId: "tenant-a", name: "Norte" },
      loading: false,
    };
    await act(async () => {
      view.rerender();
      await Promise.resolve();
    });
    mocks.branch = {
      currentBranch: { id: "branch-a", tenantId: "tenant-a", name: "Centro" },
      loading: false,
    };
    await act(async () => {
      view.rerender();
      await Promise.resolve();
    });
    mocks.getApiDetail.mockResolvedValue(detail(orderA));
    await act(async () => {
      await view.result.current.openDetail(orderA);
    });
    const listCallsBeforeOldResponse = mocks.searchApi.mock.calls.length;
    const detailCallsBeforeOldResponse = mocks.getApiDetail.mock.calls.length;

    await act(async () => {
      pending.resolve(successfulResult);
      await oldRequest;
    });
    expect(mocks.searchApi).toHaveBeenCalledTimes(listCallsBeforeOldResponse);
    expect(mocks.getApiDetail).toHaveBeenCalledTimes(detailCallsBeforeOldResponse);
    expect(view.result.current.detail?.summary.operationalStatus).toBe(
      OrderStatus.ready_for_pickup,
    );
  });

  it("solo el token propietario libera la solicitud activa", async () => {
    const pending = deferred<typeof successfulResult>();
    mocks.confirmHandover.mockReturnValueOnce(pending.promise);
    const view = await renderHistoryWithDetail();
    let first!: Promise<unknown>;
    act(() => {
      first = view.result.current.confirmStorePickupHandover("order-a");
    });

    expect(mocks.coordinator?.finishRequest(999)).toBe(false);
    expect(mocks.coordinator?.isRequestInFlight()).toBe(true);
    await act(async () => {
      await view.result.current.confirmStorePickupHandover("order-a");
    });
    expect(mocks.confirmHandover).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve(successfulResult);
      await first;
    });
    expect(mocks.coordinator?.isRequestInFlight()).toBe(false);
  });

  it("el finally de una sesion anterior no libera la mutacion de la sesion nueva", async () => {
    const firstPending = deferred<typeof successfulResult>();
    const secondPending = deferred<typeof successfulResult>();
    mocks.confirmHandover
      .mockReturnValueOnce(firstPending.promise)
      .mockReturnValueOnce(secondPending.promise);
    const order = historyItem("order-a");
    const view = await renderHistoryWithDetail(order);
    let oldRequest!: Promise<unknown>;
    act(() => {
      oldRequest = view.result.current.confirmStorePickupHandover("order-a");
    });

    mocks.session = { ...mocks.session, sessionId: "session-b" };
    const newCoordinator = new DispatchMutationCoordinator();
    mocks.coordinator = newCoordinator;
    await act(async () => {
      view.rerender();
      await Promise.resolve();
    });
    mocks.getApiDetail.mockResolvedValue(detail(order));
    await act(async () => {
      await view.result.current.openDetail(order);
    });
    let newRequest!: Promise<unknown>;
    act(() => {
      newRequest = view.result.current.confirmStorePickupHandover("order-a");
    });
    expect(newCoordinator.isRequestInFlight()).toBe(true);

    await act(async () => {
      firstPending.resolve(successfulResult);
      await oldRequest;
    });
    expect(newCoordinator.isRequestInFlight()).toBe(true);
    await act(async () => {
      await view.result.current.confirmStorePickupHandover("order-a");
    });
    expect(mocks.confirmHandover).toHaveBeenCalledTimes(2);

    await act(async () => {
      secondPending.resolve(successfulResult);
      await newRequest;
    });
    expect(newCoordinator.isRequestInFlight()).toBe(false);
  });
});
