import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeliveryMethod, OrderStatus } from "@/core/enums";
import type {
  LogisticsHistoryItemDto,
  LogisticsHistoryPageDto,
} from "@/modules/logistics/application/dto/LogisticsHistoryDto";
import { LogisticsHistoryTable } from "@/modules/logistics/components/LogisticsHistoryTable";
import { LogisticsTracePanel } from "@/modules/logistics/components/LogisticsTracePanel";
import {
  LOGISTICS_HISTORY_SEARCH_DEBOUNCE_MS,
  useLogisticsHistory,
} from "@/modules/logistics/hooks/useLogisticsHistory";

const mocks = vi.hoisted(() => ({
  usesApi: true,
  branch: {
    currentBranch: { id: "branch-1", tenantId: "tenant-1", name: "Centro" } as {
      id: string;
      tenantId: string;
      name: string;
    } | null,
    loading: false,
  },
  session: {
    user: { id: "user-1", tenantId: "tenant-1" },
    canAccessBranch: () => true,
    hasPermission: () => true,
    loading: false,
    error: null as string | null,
  },
  repositories: {},
  execute: vi.fn(),
  searchApi: vi.fn(),
  getDetail: vi.fn(),
  getApiDetail: vi.fn(),
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
vi.mock("@/modules/logistics/application/services/DispatchApplicationService", () => ({
  DispatchApplicationService: class {},
}));
vi.mock("@/modules/logistics/application/services/GetLogisticsHistoryService", () => ({
  GetLogisticsHistoryService: class {
    get usesApi() {
      return mocks.usesApi;
    }
    execute(branchId: string) {
      return mocks.execute(branchId);
    }
    searchApi(branchId: string, query: unknown) {
      return mocks.searchApi(branchId, query);
    }
    getDetail(branchId: string, orderId: string) {
      return mocks.getDetail(branchId, orderId);
    }
    getApiDetail(branchId: string, item: unknown) {
      return mocks.getApiDetail(branchId, item);
    }
  },
}));

function item(index: number, overrides: Partial<LogisticsHistoryItemDto> = {}): LogisticsHistoryItemDto {
  return {
    sourceType: "order",
    sourceId: `order-${index}`,
    orderId: `order-${index}`,
    orderReference: `WEB-${index}`,
    deliveryMethod: DeliveryMethod.home_delivery,
    operationalStatus: OrderStatus.delivered,
    contactName: `Cliente ${index}`,
    contactPhone: null,
    pickingOrderId: `picking-${index}`,
    packingId: null,
    dispatchId: null,
    storePickupDeliveryId: null,
    pickingCompletedAt: "2026-10-09T15:00:00.000Z",
    packingFinalizedAt: null,
    dispatchedAt: null,
    deliveredAt: null,
    responsibleUserId: null,
    responsibleUserName: null,
    totalWeight: null,
    packageCount: null,
    dispatchStatus: null,
    carrierName: null,
    trackingNumber: null,
    ...overrides,
  };
}

function page(items: LogisticsHistoryItemDto[], overrides: Partial<LogisticsHistoryPageDto> = {}) {
  return { items, page: 1, pageSize: 10, totalItems: items.length, totalPages: 1, ...overrides };
}

async function renderHistory() {
  const view = renderHook(() => useLogisticsHistory());
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  return view;
}

describe("useLogisticsHistory en modo API", () => {
  beforeEach(() => {
    mocks.usesApi = true;
    mocks.branch = {
      currentBranch: { id: "branch-1", tenantId: "tenant-1", name: "Centro" },
      loading: false,
    };
    mocks.searchApi.mockResolvedValue(page([item(1), item(2)], { totalItems: 25, totalPages: 3 }));
    mocks.getApiDetail.mockResolvedValue({ summary: item(1), items: [] });
  });

  it("carga la primera página del backend y expone el total del servidor", async () => {
    const { result } = await renderHistory();

    expect(mocks.searchApi).toHaveBeenCalledWith("branch-1", {
      search: "",
      status: "all",
      deliveryMethod: "all",
      from: "",
      to: "",
      page: 1,
      pageSize: 10,
    });
    expect(result.current.items).toHaveLength(2);
    expect(result.current.pagination).toEqual({
      mode: "server",
      page: 1,
      pageSize: 10,
      totalItems: 25,
      totalPages: 3,
    });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("pide otra página y vuelve a la primera al cambiar filtros o tamaño", async () => {
    const { result } = await renderHistory();

    act(() => result.current.setPage(2));
    await waitFor(() => expect(mocks.searchApi).toHaveBeenLastCalledWith("branch-1", expect.objectContaining({ page: 2 })));

    act(() => result.current.updateFilters({ status: OrderStatus.cancelled }));
    await waitFor(() =>
      expect(mocks.searchApi).toHaveBeenLastCalledWith(
        "branch-1",
        expect.objectContaining({ page: 1, status: OrderStatus.cancelled }),
      ),
    );

    act(() => result.current.setPage(3));
    act(() => result.current.setPageSize(50));
    await waitFor(() =>
      expect(mocks.searchApi).toHaveBeenLastCalledWith(
        "branch-1",
        expect.objectContaining({ page: 1, pageSize: 50 }),
      ),
    );
  });

  it("espera a que el usuario deje de escribir antes de buscar", async () => {
    const { result } = await renderHistory();
    const callsBefore = mocks.searchApi.mock.calls.length;

    act(() => result.current.updateFilters({ search: "W" }));
    act(() => result.current.updateFilters({ search: "WE" }));
    act(() => result.current.updateFilters({ search: " WEB " }));
    expect(mocks.searchApi.mock.calls.length).toBe(callsBefore);

    await waitFor(
      () =>
        expect(mocks.searchApi).toHaveBeenLastCalledWith(
          "branch-1",
          expect.objectContaining({ search: "WEB", page: 1 }),
        ),
      { timeout: LOGISTICS_HISTORY_SEARCH_DEBOUNCE_MS * 5 },
    );
    expect(mocks.searchApi.mock.calls.filter(([, query]) => (query as { search: string }).search !== "")).toHaveLength(1);
  });

  it("abre el detalle por tipo e id de origen", async () => {
    const { result } = await renderHistory();

    await act(async () => result.current.openDetail(item(1)));

    expect(mocks.getApiDetail).toHaveBeenCalledWith("branch-1", item(1));
    expect(mocks.getDetail).not.toHaveBeenCalled();
    expect(result.current.detailOpen).toBe(true);
    expect(result.current.detail?.summary.orderReference).toBe("WEB-1");
  });

  it("ignora la página de una sucursal anterior que responde tarde", async () => {
    let resolveSlow!: (value: LogisticsHistoryPageDto) => void;
    mocks.searchApi.mockReturnValueOnce(new Promise((resolve) => (resolveSlow = resolve)));
    const view = renderHook(() => useLogisticsHistory());
    await waitFor(() => expect(mocks.searchApi).toHaveBeenCalledTimes(1));

    mocks.branch = { currentBranch: { id: "branch-2", tenantId: "tenant-1", name: "Norte" }, loading: false };
    view.rerender();
    await waitFor(() => expect(view.result.current.items.map((row) => row.orderId)).toEqual(["order-1", "order-2"]));
    resolveSlow(page([item(99)]));
    await act(async () => Promise.resolve());

    expect(view.result.current.items.map((row) => row.orderId)).toEqual(["order-1", "order-2"]);
  });

  it("muestra el error del backend y vacía la página", async () => {
    mocks.searchApi.mockRejectedValueOnce(new Error("Sin capacidad de inventario"));
    const { result } = await renderHistory();
    expect(result.current.error).toBe("Sin capacidad de inventario");
    expect(result.current.items).toEqual([]);
    expect(result.current.pagination.totalItems).toBe(0);
  });
});

describe("useLogisticsHistory en modo mock", () => {
  beforeEach(() => {
    mocks.usesApi = false;
    mocks.execute.mockResolvedValue([
      item(1, { deliveryMethod: DeliveryMethod.store_pickup }),
      item(2),
    ]);
  });

  it("conserva el filtrado en el cliente sin volver a consultar", async () => {
    const { result } = await renderHistory();
    const calls = mocks.execute.mock.calls.length;

    act(() => result.current.updateFilters({ deliveryMethod: DeliveryMethod.store_pickup }));

    expect(result.current.items.map((row) => row.orderId)).toEqual(["order-1"]);
    expect(result.current.pagination).toMatchObject({ mode: "client", totalItems: 1, totalPages: 1 });
    expect(mocks.execute.mock.calls.length).toBe(calls);
    expect(mocks.searchApi).not.toHaveBeenCalled();
  });
});

describe("componentes del historial", () => {
  it("la tabla con paginación del servidor no recorta la página y muestra el total del backend", () => {
    render(
      <LogisticsHistoryTable
        canConfirmDispatch={false}
        currentPage={2}
        items={[item(11), item(12)]}
        onAddGuide={() => undefined}
        onPageChange={() => undefined}
        onPageSizeChange={() => undefined}
        pageSize={10}
        serverTotalItems={12}
      />,
    );
    expect(screen.getByText("Mostrando 11-12 de 12 registros")).toBeInTheDocument();
    expect(screen.getByText("WEB-11")).toBeInTheDocument();
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
  });

  it("distingue pedidos y traslados y muestra la modalidad correcta", () => {
    render(
      <LogisticsHistoryTable
        canConfirmDispatch={false}
        currentPage={1}
        items={[
          item(1),
          item(2, { deliveryMethod: DeliveryMethod.store_pickup }),
          item(3, {
            sourceType: "transfer",
            orderReference: "Traslado TR-7",
            deliveryMethod: "transfer",
            contactName: "Destino: Norte",
          }),
        ]}
        onAddGuide={() => undefined}
        onPageChange={() => undefined}
        onPageSizeChange={() => undefined}
        pageSize={10}
      />,
    );
    expect(screen.getAllByText("Pedido")).toHaveLength(2);
    expect(screen.getByText("Traslado")).toBeInTheDocument();
    expect(screen.getByText("Envío a domicilio")).toBeInTheDocument();
    expect(screen.getByText("Retiro en tienda/bodega")).toBeInTheDocument();
    expect(screen.getByText("Traslado entre sucursales")).toBeInTheDocument();
    expect(screen.getByText("Mostrando 1-3 de 3 registros")).toBeInTheDocument();
  });

  it("el panel distingue una etapa sin registro de una cantidad cero", () => {
    const line = {
      pickingItemId: "line-1",
      orderItemId: "line-1",
      productId: "product-1",
      sku: "",
      name: "Cable THHN",
      requestedQuantity: 3,
      pickedQuantity: 3,
      allocations: [],
    };
    render(
      <LogisticsTracePanel
        error={null}
        state="data"
        items={[
          { ...line, packedQuantity: null, dispatchedQuantity: null },
          { ...line, pickingItemId: "line-2", packedQuantity: 0, dispatchedQuantity: 0 },
        ]}
      />,
    );
    expect(screen.getByText("3 de 3 · empacado sin registro · despachado sin registro")).toBeInTheDocument();
    expect(screen.getByText("3 de 3 · empacado 0 · despachado 0")).toBeInTheDocument();
  });

  it("el panel de trazabilidad omite SKU y ubicación vacíos y muestra cantidades derivadas", () => {
    render(
      <LogisticsTracePanel
        error={null}
        state="data"
        items={[
          {
            pickingItemId: "line-1",
            orderItemId: "line-1",
            productId: "product-1",
            sku: "",
            name: "Cable THHN",
            requestedQuantity: 3,
            pickedQuantity: 3,
            packedQuantity: 3,
            dispatchedQuantity: 2,
            allocations: [
              {
                reservationId: "",
                quantity: 3,
                location: { id: "location-1", code: "", name: "" },
                lot: null,
                serial: null,
              },
            ],
          },
        ]}
      />,
    );
    expect(screen.getByText("3 de 3 · empacado 3 · despachado 2")).toBeInTheDocument();
    expect(screen.getByText("Ubicación registrada")).toBeInTheDocument();
  });
});
