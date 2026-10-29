import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import type { PickingPhysicalSelectionResult } from "@/modules/logistics/application/pickingPhysicalSelection";
import { useLogisticsPicking } from "@/modules/logistics/hooks/useLogisticsPicking";
import { deferred } from "./dispatchFixtures";
import { pickingDetail, pickingIds, plainLine, queueItem } from "./pickingFixtures";

const mocks = vi.hoisted(() => ({
  repositories: { pickingCommandsEnabled: true, pickingReadDataSource: "api" } as object,
  eventBus: null as unknown as DataEventBus,
  branch: {} as { currentBranch: { id: string; tenantId: string; name: string } | null; loading: boolean },
  session: {} as {
    user: { id: string; tenantId: string } | null;
    canAccessBranch: ReturnType<typeof vi.fn>;
    hasPermission: ReturnType<typeof vi.fn>;
    loading: boolean;
    error: string | null;
  },
  service: {
    getQueue: vi.fn(),
    getDetail: vi.fn(),
    updateLine: vi.fn(),
  },
}));

vi.mock("@/infrastructure/providers/RepositoryProvider", () => ({
  useRepositories: () => mocks.repositories,
  useDataEventBus: () => mocks.eventBus,
}));
vi.mock("@/modules/auth/hooks/useCurrentSession", () => ({ useCurrentSession: () => mocks.session }));
vi.mock("@/shared/navigation/PrivateHeader/ActiveBranchProvider", () => ({ useActiveBranch: () => mocks.branch }));
vi.mock("@/modules/logistics/application/services/PickingApplicationService", () => ({
  PickingApplicationService: class {
    getQueue(branchId: string) {
      return mocks.service.getQueue(branchId);
    }

    getDetail(branchId: string, pickingOrderId: string) {
      return mocks.service.getDetail(branchId, pickingOrderId);
    }

    updateLine(branchId: string, command: unknown) {
      return mocks.service.updateLine(branchId, command);
    }
  },
}));

const selection = { trackingSelections: [] } as unknown as PickingPhysicalSelectionResult;
const initial = pickingDetail([plainLine("1"), plainLine("2")]);
const updated = pickingDetail([plainLine("1", { pickedQuantity: 4 }), plainLine("2")]);

async function openedHook() {
  const loadings: boolean[] = [];
  const detailLoadings: boolean[] = [];
  const view = renderHook(() => {
    const hook = useLogisticsPicking();
    loadings.push(hook.loading);
    detailLoadings.push(hook.detailLoading);
    return hook;
  });
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  await act(async () => {
    await view.result.current.openPicking(queueItem(initial));
  });
  expect(view.result.current.detail).toEqual(initial);
  loadings.length = 0;
  detailLoadings.length = 0;
  return { view, loadings, detailLoadings };
}

describe("Picking: actualizaciones sin reconstruir la mesa", () => {
  beforeEach(() => {
    mocks.eventBus = new DataEventBus();
    mocks.branch = {
      currentBranch: { id: pickingIds.branch, tenantId: pickingIds.tenant, name: "Central" },
      loading: false,
    };
    mocks.session = {
      user: { id: pickingIds.user, tenantId: pickingIds.tenant },
      canAccessBranch: vi.fn(() => true),
      hasPermission: vi.fn(() => true),
      loading: false,
      error: null,
    };
    mocks.service.getQueue.mockReset().mockResolvedValue([queueItem(initial)]);
    mocks.service.getDetail.mockReset().mockResolvedValue(initial);
    mocks.service.updateLine.mockReset().mockResolvedValue(updated);
  });

  it("registrar una cantidad aplica la respuesta sin volver a mostrar la carga global", async () => {
    const { view, loadings, detailLoadings } = await openedHook();

    await act(async () => {
      await expect(view.result.current.updateLine(initial.lines[0]!, 4, selection)).resolves.toBe(true);
    });
    await waitFor(() => expect(mocks.service.getQueue).toHaveBeenCalledTimes(2));

    expect(mocks.service.updateLine).toHaveBeenCalledOnce();
    expect(view.result.current.detail).toEqual(updated);
    expect(view.result.current.selectedPickingOrderId).toBe(pickingIds.picking);
    expect(view.result.current.submitting).toBe(false);
    expect(loadings.length).toBeGreaterThan(0);
    expect(loadings.every((value) => value === false)).toBe(true);
    expect(detailLoadings.every((value) => value === false)).toBe(true);
  });

  it("la lectura de la cola posterior al guardado es en segundo plano: conserva la cola visible", async () => {
    const { view } = await openedHook();
    const refresh = deferred<ReturnType<typeof queueItem>[]>();
    mocks.service.getQueue.mockReturnValueOnce(refresh.promise);

    await act(async () => {
      await view.result.current.updateLine(initial.lines[0]!, 4, selection);
    });

    expect(view.result.current.loading).toBe(false);
    expect(view.result.current.queue).toEqual([queueItem(initial)]);
    await act(async () => {
      refresh.resolve([queueItem(updated)]);
      await refresh.promise;
    });
    expect(view.result.current.queue).toEqual([queueItem(updated)]);
  });

  it("si el backend rechaza el guardado conserva el detalle anterior y muestra el mensaje", async () => {
    const { view, loadings } = await openedHook();
    mocks.service.updateLine.mockRejectedValueOnce(new Error("La cantidad supera la reserva."));

    await act(async () => {
      await expect(view.result.current.updateLine(initial.lines[0]!, 4, selection)).resolves.toBe(false);
    });

    expect(view.result.current.detail).toEqual(initial);
    expect(view.result.current.workspaceError).toBe("La cantidad supera la reserva.");
    expect(view.result.current.submitting).toBe(false);
    expect(loadings.every((value) => value === false)).toBe(true);
    expect(mocks.service.getQueue).toHaveBeenCalledTimes(1);
  });

  it("no libera el bloqueo hasta recibir la respuesta: una segunda operacion simultanea se rechaza", async () => {
    const { view } = await openedHook();
    const pendingSave = deferred<typeof updated>();
    mocks.service.updateLine.mockReturnValueOnce(pendingSave.promise);

    let first!: Promise<boolean>;
    act(() => {
      first = view.result.current.updateLine(initial.lines[0]!, 4, selection);
    });
    await waitFor(() => expect(view.result.current.submitting).toBe(true));

    await act(async () => {
      await expect(view.result.current.updateLine(initial.lines[1]!, 3, selection)).resolves.toBe(false);
    });
    expect(mocks.service.updateLine).toHaveBeenCalledOnce();
    expect(view.result.current.detail).toEqual(initial);

    await act(async () => {
      pendingSave.resolve(updated);
      await first;
    });
    expect(view.result.current.detail).toEqual(updated);
    expect(view.result.current.submitting).toBe(false);
  });

  it("publica el cambio en el bus interno para Packing y Despacho, y no se reacciona a si mismo", async () => {
    const { view } = await openedHook();
    const heard = vi.fn();
    mocks.eventBus.subscribe("picking.changed", heard);

    await act(async () => {
      await view.result.current.updateLine(initial.lines[0]!, 4, selection);
    });

    expect(heard).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: pickingIds.tenant,
      branchId: pickingIds.branch,
      pickingOrderId: pickingIds.picking,
      metadata: { origin: expect.any(String) },
    }));
    await waitFor(() => expect(mocks.service.getQueue).toHaveBeenCalledTimes(2));
    expect(mocks.service.getDetail).toHaveBeenCalledTimes(1);
  });

  it("un cambio ajeno refresca el detalle en silencio, sin indicadores de carga", async () => {
    const { view, loadings, detailLoadings } = await openedHook();
    const remote = pickingDetail([plainLine("1", { pickedQuantity: 6 }), plainLine("2")]);
    mocks.service.getDetail.mockResolvedValueOnce(remote);

    act(() => {
      mocks.eventBus.emit("picking.changed", {
        tenantId: pickingIds.tenant,
        branchId: pickingIds.branch,
        pickingOrderId: pickingIds.picking,
      });
    });

    await waitFor(() => expect(view.result.current.detail).toEqual(remote));
    expect(loadings.every((value) => value === false)).toBe(true);
    expect(detailLoadings.every((value) => value === false)).toBe(true);
  });

  it("ignora eventos de otra sucursal", async () => {
    await openedHook();
    mocks.service.getQueue.mockClear();

    act(() => {
      mocks.eventBus.emit("picking.changed", {
        tenantId: pickingIds.tenant,
        branchId: "99999999-0000-4000-8000-000000000000",
        pickingOrderId: pickingIds.picking,
      });
    });

    expect(mocks.service.getQueue).not.toHaveBeenCalled();
  });

  it("una lectura tardia anterior a la mutacion no pisa el detalle confirmado por el backend", async () => {
    const { view } = await openedHook();
    const staleRead = deferred<typeof initial>();
    mocks.service.getDetail.mockReturnValueOnce(staleRead.promise);
    act(() => {
      mocks.eventBus.emit("picking.changed", {
        tenantId: pickingIds.tenant,
        branchId: pickingIds.branch,
        pickingOrderId: pickingIds.picking,
      });
    });
    await waitFor(() => expect(mocks.service.getDetail).toHaveBeenCalledTimes(2));

    await act(async () => {
      await view.result.current.updateLine(initial.lines[0]!, 4, selection);
    });
    expect(view.result.current.detail).toEqual(updated);

    await act(async () => {
      staleRead.resolve(initial);
      await staleRead.promise;
    });

    expect(view.result.current.detail).toEqual(updated);
  });

  it("durante una operacion en curso un evento no dispara lecturas de detalle", async () => {
    const { view } = await openedHook();
    const pendingSave = deferred<typeof updated>();
    mocks.service.updateLine.mockReturnValueOnce(pendingSave.promise);
    let save!: Promise<boolean>;
    act(() => {
      save = view.result.current.updateLine(initial.lines[0]!, 4, selection);
    });
    await waitFor(() => expect(view.result.current.submitting).toBe(true));
    mocks.service.getDetail.mockClear();

    act(() => {
      mocks.eventBus.emit("picking.changed", {
        tenantId: pickingIds.tenant,
        branchId: pickingIds.branch,
        pickingOrderId: pickingIds.picking,
      });
    });
    expect(mocks.service.getDetail).not.toHaveBeenCalled();

    await act(async () => {
      pendingSave.resolve(updated);
      await save;
    });
  });
});
