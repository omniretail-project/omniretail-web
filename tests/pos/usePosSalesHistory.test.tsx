import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SaleStatus } from "@/core/enums";
import type {
  PosSaleHistoryItemDto,
  PosSaleHistoryRowDto,
} from "@/modules/pos/application/dto/PosSaleHistoryDto";
import { usePosSalesHistory } from "@/modules/pos/hooks/usePosSalesHistory";

const mocks = vi.hoisted(() => ({
  repositories: {},
  branch: {
    currentBranch: { id: "branch-1", tenantId: "tenant-1", name: "Centro" },
    loading: false,
  },
  session: {
    user: { id: "user-1", tenantId: "tenant-1" },
    canAccessBranch: () => true,
    hasPermission: () => true,
    loading: false,
    error: null as string | null,
  },
  execute: vi.fn(),
  getSaleDetail: vi.fn(),
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
vi.mock("@/modules/pos/application/services/GetPosSalesHistoryService", () => ({
  GetPosSalesHistoryService: class {
    execute(input: unknown) {
      return mocks.execute(input);
    }
    getSaleDetail(input: unknown) {
      return mocks.getSaleDetail(input);
    }
  },
}));

function row(index: number): PosSaleHistoryRowDto {
  return {
    saleId: `sale-${index}`,
    documentNumber: `V-${index}`,
    createdAt: "2026-10-09T15:00:00.000Z",
    customerDisplayName: "Consumidor final",
    total: 10,
    saleStatus: SaleStatus.completed,
    saleStatusLabel: "Completada",
    saleStatusTone: "success",
    deliveryMethodLabel: "Entrega inmediata",
    operationalStatusLabel: "—",
    operationalStatusTone: "neutral",
    hasUnavailableOrder: false,
  };
}

function withDetail(sale: PosSaleHistoryRowDto): PosSaleHistoryItemDto {
  return { ...sale, documentType: "ticket", paymentSummary: "Efectivo", payments: [], items: [] };
}

async function renderHistory() {
  const view = renderHook(() => usePosSalesHistory());
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  return view;
}

describe("usePosSalesHistory", () => {
  beforeEach(() => {
    mocks.execute.mockImplementation(async ({ page, pageSize }: { page: number; pageSize: number }) => ({
      sales: [row(1), row(2), row(3)],
      summary: { total: 30, active: 30, partiallyReturned: 0, returned: 0, cancelled: 0 },
      page,
      pageSize,
      totalItems: 30,
      totalPages: Math.ceil(30 / pageSize),
    }));
    mocks.getSaleDetail.mockImplementation(async ({ sale }: { sale: PosSaleHistoryRowDto }) =>
      withDetail(sale),
    );
  });

  it("listar no pide el detalle de ninguna venta", async () => {
    const { result } = await renderHistory();
    expect(result.current.sales).toHaveLength(3);
    expect(mocks.getSaleDetail).not.toHaveBeenCalled();
    expect(result.current.getLoadedSale("sale-1")).toBeNull();
  });

  it("al abrir pide una sola página al servicio y expone el total del servidor", async () => {
    const { result } = await renderHistory();

    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.execute).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 10 }));
    expect(result.current.pagination).toEqual({ page: 1, pageSize: 10, totalItems: 30, totalPages: 3 });
  });

  it("cambia de página y vuelve a la primera al filtrar o cambiar el tamaño", async () => {
    const { result } = await renderHistory();

    act(() => result.current.setPage(2));
    await waitFor(() => expect(mocks.execute).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })));
    await waitFor(() => expect(result.current.pagination.page).toBe(2));

    act(() => result.current.updateFilters({ search: "V-1" }));
    await waitFor(() =>
      expect(mocks.execute).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 1, filters: expect.objectContaining({ search: "V-1" }) }),
      ),
    );

    act(() => result.current.setPage(3));
    act(() => result.current.setPageSize(25));
    await waitFor(() =>
      expect(mocks.execute).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, pageSize: 25 })),
    );

    act(() => result.current.setPage(2));
    act(() => result.current.resetFilters());
    await waitFor(() =>
      expect(mocks.execute).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 1, filters: expect.objectContaining({ search: "" }) }),
      ),
    );
  });

  it("carga el detalle de una sola venta al pedirlo y lo reutiliza", async () => {
    const { result } = await renderHistory();

    let sale: PosSaleHistoryItemDto | null = null;
    await act(async () => {
      sale = await result.current.loadSaleDetail("sale-2");
    });
    await act(async () => {
      await result.current.loadSaleDetail("sale-2");
    });

    expect(sale).toMatchObject({ saleId: "sale-2", paymentSummary: "Efectivo" });
    expect(mocks.getSaleDetail).toHaveBeenCalledTimes(1);
    expect(mocks.getSaleDetail).toHaveBeenCalledWith({
      actorUserId: "user-1",
      branchId: "branch-1",
      sale: row(2),
    });
    expect(result.current.getLoadedSale("sale-2")?.paymentSummary).toBe("Efectivo");
    expect(result.current.detailLoadingId).toBeNull();
  });

  it("usa sin consultar las filas que ya llegan completas (modo mock)", async () => {
    mocks.execute.mockResolvedValue({
      sales: [withDetail(row(1))],
      summary: { total: 1, active: 1, partiallyReturned: 0, returned: 0, cancelled: 0 },
      page: 1,
      pageSize: 10,
      totalItems: 1,
      totalPages: 1,
    });
    const { result } = await renderHistory();

    await act(async () => {
      await result.current.loadSaleDetail("sale-1");
    });

    expect(mocks.getSaleDetail).not.toHaveBeenCalled();
    expect(result.current.getLoadedSale("sale-1")?.documentType).toBe("ticket");
  });

  it("informa el error del detalle sin vaciar el listado", async () => {
    mocks.getSaleDetail.mockRejectedValueOnce(new Error("Venta no encontrada"));
    const { result } = await renderHistory();

    await act(async () => {
      expect(await result.current.loadSaleDetail("sale-3")).toBeNull();
    });

    expect(result.current.detailError).toBe("Venta no encontrada");
    expect(result.current.sales).toHaveLength(3);
    expect(await result.current.loadSaleDetail("no-existe")).toBeNull();
  });

  it("descarta los detalles cargados al recargar el listado", async () => {
    const { result } = await renderHistory();
    await act(async () => {
      await result.current.loadSaleDetail("sale-1");
    });

    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.getLoadedSale("sale-1")).toBeNull();
  });
});
