import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PickingFefoPreviewDto } from "@/modules/logistics/application/dto/PickingReadModelDto";
import { usePickingFefoPreview } from "@/modules/logistics/hooks/usePickingFefoPreview";

const id = (suffix: number) =>
  `50000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const ids = { session: id(1), user: id(2), tenant: id(3), branch: id(4), otherBranch: id(5), picking: id(6), line: id(7), product: id(8), location: id(9), lot: id(10), otherLocation: id(11) };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

const mocks = vi.hoisted(() => ({
  branch: {} as { currentBranch: { id: string; tenantId: string } | null; loading: boolean },
  session: {} as {
    sessionId: string | null;
    user: { id: string; tenantId: string } | null;
    canAccessBranch: (branchId: string) => boolean;
    hasPermission: (permission: string) => boolean;
    loading: boolean;
  },
  execute: vi.fn(),
}));
const repositories = vi.hoisted(() => ({ pickingReadDataSource: "api" as "api" | "mock" }));

vi.mock("@/infrastructure/providers/RepositoryProvider", () => ({ useRepositories: () => repositories }));
vi.mock("@/modules/auth/hooks/useCurrentSession", () => ({ useCurrentSession: () => mocks.session }));
vi.mock("@/shared/navigation/PrivateHeader/ActiveBranchProvider", () => ({ useActiveBranch: () => mocks.branch }));
vi.mock("@/modules/logistics/application/services/PickingApplicationService", () => ({
  PickingApplicationService: class {
    getFefoPreview(branchId: string, query: unknown) { return mocks.execute(branchId, query); }
  },
}));

const query = { pickingOrderId: ids.picking, pickingLineId: ids.line, productId: ids.product, locationId: ids.location, pickedQuantity: 10 };
function preview(branchId = ids.branch): PickingFefoPreviewDto {
  return {
    pickingOrderId: ids.picking,
    pickingLineId: ids.line,
    productId: ids.product,
    branchId,
    location: { id: ids.location, code: "A-01", name: "Estante" },
    currentPickedQuantity: 0,
    targetPickedQuantity: 10,
    incrementalQuantity: 10,
    existingSelections: [],
    incrementalAllocations: [{ locationId: ids.location, locationCode: "A-01", locationName: "Estante", lotId: ids.lot, lotNumber: "LOT-1", expirationDate: "2027-01-01", quantity: 10 }],
    resultingSelections: [],
    calculatedAt: "2026-10-19T12:00:00-06:00",
    provisional: true,
  };
}

describe("usePickingFefoPreview", () => {
  beforeEach(() => {
    repositories.pickingReadDataSource = "api";
    mocks.branch = { currentBranch: { id: ids.branch, tenantId: ids.tenant }, loading: false };
    mocks.session = {
      sessionId: ids.session,
      user: { id: ids.user, tenantId: ids.tenant },
      canAccessBranch: () => true,
      hasPermission: (permission) => permission === "logistics.picking.start",
      loading: false,
    };
    mocks.execute.mockReset();
    mocks.execute.mockResolvedValue(preview());
  });

  it("consulta automaticamente con el contexto confiable y publica la respuesta vigente", async () => {
    const { result } = renderHook(() => usePickingFefoPreview(query));
    await waitFor(() => expect(result.current.status).toBe("loaded"));
    expect(mocks.execute).toHaveBeenCalledWith(ids.branch, query);
    expect(result.current.data?.incrementalQuantity).toBe(10);
  });

  it("descarta respuestas tardias al cambiar de sucursal A-B-A", async () => {
    const pending = deferred<PickingFefoPreviewDto>();
    mocks.execute.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(preview());
    const view = renderHook(() => usePickingFefoPreview(query));
    await waitFor(() => expect(view.result.current.status).toBe("loading"));

    mocks.branch = { currentBranch: { id: ids.otherBranch, tenantId: ids.tenant }, loading: false };
    view.rerender();
    await waitFor(() => expect(mocks.execute).toHaveBeenCalledTimes(2));
    mocks.branch = { currentBranch: { id: ids.branch, tenantId: ids.tenant }, loading: false };
    view.rerender();
    await waitFor(() => expect(mocks.execute).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(view.result.current.status).toBe("loaded"));

    pending.resolve(preview());
    await act(async () => { await pending.promise; });
    expect(view.result.current.status).toBe("loaded");
    expect(mocks.execute).toHaveBeenCalledTimes(3);
  });

  it("descarta la recomendacion tardia al cambiar ubicacion y cantidad objetivo", async () => {
    const pending = deferred<PickingFefoPreviewDto>();
    const nextQuery = { ...query, locationId: ids.otherLocation, pickedQuantity: 5 };
    const nextPreview: PickingFefoPreviewDto = {
      ...preview(),
      location: { id: ids.otherLocation, code: "B-02", name: "Estante B" },
      targetPickedQuantity: 5,
      incrementalQuantity: 5,
      incrementalAllocations: [{
        ...preview().incrementalAllocations[0],
        locationId: ids.otherLocation,
        locationCode: "B-02",
        locationName: "Estante B",
        quantity: 5,
      }],
    };
    mocks.execute.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(nextPreview);
    const view = renderHook(
      ({ activeQuery }) => usePickingFefoPreview(activeQuery),
      { initialProps: { activeQuery: query } },
    );
    await waitFor(() => expect(view.result.current.status).toBe("loading"));

    view.rerender({ activeQuery: nextQuery });
    await waitFor(() => expect(view.result.current.status).toBe("loaded"));
    expect(view.result.current.data?.location.id).toBe(ids.otherLocation);
    expect(view.result.current.data?.targetPickedQuantity).toBe(5);

    pending.resolve(preview());
    await act(async () => { await pending.promise; });
    expect(view.result.current.data?.location.id).toBe(ids.otherLocation);
    expect(view.result.current.data?.targetPickedQuantity).toBe(5);
  });

  it("no consulta en mock ni sin permiso y no conserva una vista previa anterior", async () => {
    const view = renderHook(() => usePickingFefoPreview(query));
    await waitFor(() => expect(view.result.current.status).toBe("loaded"));

    mocks.session = { ...mocks.session, hasPermission: () => false };
    view.rerender();
    expect(view.result.current.status).toBe("idle");
    expect(view.result.current.data).toBeNull();
    expect(mocks.execute).toHaveBeenCalledOnce();

    repositories.pickingReadDataSource = "mock";
    mocks.session = { ...mocks.session, hasPermission: () => true };
    view.rerender();
    expect(view.result.current.canQuery).toBe(false);
    expect(view.result.current.data).toBeNull();
    expect(mocks.execute).toHaveBeenCalledOnce();
  });
});
