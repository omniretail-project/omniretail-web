import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import type { PosTraceabilityInventoryDto } from "@/modules/pos/application/dto/PosTraceabilityInventoryDto";
import { usePosTraceabilityInventory } from "@/modules/pos/hooks/usePosTraceabilityInventory";
import { ids } from "./posFixtures";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

const mocks = vi.hoisted(() => ({
  branch: {} as {
    currentBranch: { id: string; tenantId: string; name: string } | null;
    loading: boolean;
  },
  session: {} as {
    sessionId: string | null;
    user: { id: string; tenantId: string } | null;
    canAccessBranch: (branchId: string) => boolean;
    hasPermission: (permission: string) => boolean;
    loading: boolean;
    error: string | null;
  },
  execute: vi.fn(),
}));

const stableRepositories = vi.hoisted(() => ({ inventoryStockDataSource: "api" as const }));

vi.mock("@/infrastructure/providers/RepositoryProvider", () => ({
  useRepositories: () => stableRepositories,
}));
vi.mock("@/modules/auth/hooks/useCurrentSession", () => ({
  useCurrentSession: () => mocks.session,
}));
vi.mock("@/shared/navigation/PrivateHeader/ActiveBranchProvider", () => ({
  useActiveBranch: () => mocks.branch,
}));
vi.mock("@/modules/pos/application/services/GetPosTraceabilityInventoryService", () => ({
  POS_TRACEABILITY_STOCK_PERMISSION: "inventory.stock.read",
  POS_TRACEABILITY_LOCATIONS_PERMISSION: "catalog.locations.read",
  GetPosTraceabilityInventoryService: class {
    execute(input: unknown) {
      return mocks.execute(input);
    }
  },
}));

function inventory(productId = ids.product, branchId = ids.branch): PosTraceabilityInventoryDto {
  return {
    branchId,
    productId,
    locations: [],
    lots: [],
    serials: [],
    combinations: [],
  };
}

async function renderTraceabilityHook() {
  const view = renderHook(() => usePosTraceabilityInventory());
  await act(async () => {
    await Promise.resolve();
  });
  return view;
}

describe("usePosTraceabilityInventory", () => {
  beforeEach(() => {
    mocks.branch = {
      currentBranch: { id: ids.branch, tenantId: ids.tenant, name: "Principal" },
      loading: false,
    };
    mocks.session = {
      sessionId: ids.session,
      user: { id: ids.user, tenantId: ids.tenant },
      canAccessBranch: () => true,
      hasPermission: () => true,
      loading: false,
      error: null,
    };
    mocks.execute.mockResolvedValue(inventory());
  });

  it("consulta el producto en la sucursal activa y conserva los filtros", async () => {
    const { result } = await renderTraceabilityHook();

    await act(async () => {
      expect(
        await result.current.load(ids.product, { locationId: ids.location, lotId: ids.lot }),
      ).toBe(true);
    });

    expect(mocks.execute).toHaveBeenCalledWith({
      branchId: ids.branch,
      productId: ids.product,
      locationId: ids.location,
      lotId: ids.lot,
    });
    expect(result.current.status).toBe("loaded");
    expect(result.current.data?.productId).toBe(ids.product);
  });

  it("descarta la respuesta de un producto anterior y conserva la consulta nueva", async () => {
    const first = deferred<PosTraceabilityInventoryDto>();
    const second = deferred<PosTraceabilityInventoryDto>();
    const otherProductId = "20000000-0000-4000-8000-000000000001";
    mocks.execute.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = await renderTraceabilityHook();

    let firstLoad!: Promise<boolean>;
    let secondLoad!: Promise<boolean>;
    act(() => {
      firstLoad = result.current.load(ids.product);
      secondLoad = result.current.load(otherProductId);
    });
    first.resolve(inventory(ids.product));
    await act(async () => {
      expect(await firstLoad).toBe(false);
    });
    expect(result.current.data).toBeNull();

    second.resolve(inventory(otherProductId));
    await act(async () => {
      expect(await secondLoad).toBe(true);
    });
    expect(result.current.data?.productId).toBe(otherProductId);
  });

  it("invalida respuestas tardias al cambiar de sucursal o cerrar la consulta", async () => {
    const branchRequest = deferred<PosTraceabilityInventoryDto>();
    mocks.execute.mockReturnValueOnce(branchRequest.promise);
    const view = await renderTraceabilityHook();
    let branchLoad!: Promise<boolean>;
    act(() => {
      branchLoad = view.result.current.load(ids.product);
    });

    mocks.branch = {
      currentBranch: { id: ids.otherBranch, tenantId: ids.tenant, name: "Norte" },
      loading: false,
    };
    view.rerender();
    branchRequest.resolve(inventory(ids.product, ids.branch));
    await act(async () => {
      expect(await branchLoad).toBe(false);
    });
    expect(view.result.current.data).toBeNull();

    const closeRequest = deferred<PosTraceabilityInventoryDto>();
    mocks.execute.mockReturnValueOnce(closeRequest.promise);
    let closeLoad!: Promise<boolean>;
    act(() => {
      closeLoad = view.result.current.load(ids.product);
      view.result.current.close();
    });
    closeRequest.resolve(inventory(ids.product, ids.otherBranch));
    await act(async () => {
      expect(await closeLoad).toBe(false);
    });
    expect(view.result.current.status).toBe("idle");
  });

  it("descarta una respuesta iniciada por una sesion anterior", async () => {
    const pending = deferred<PosTraceabilityInventoryDto>();
    mocks.execute.mockReturnValueOnce(pending.promise);
    const view = await renderTraceabilityHook();
    let loading!: Promise<boolean>;
    act(() => {
      loading = view.result.current.load(ids.product);
    });

    mocks.session = {
      ...mocks.session,
      sessionId: "20000000-0000-4000-8000-000000000045",
      user: {
        id: "20000000-0000-4000-8000-000000000046",
        tenantId: ids.tenant,
      },
    };
    view.rerender();
    pending.resolve(inventory());

    await act(async () => {
      expect(await loading).toBe(false);
    });
    expect(view.result.current.status).toBe("idle");
    expect(view.result.current.data).toBeNull();
  });

  it("expone errores de red y permisos sin fabricar resultados", async () => {
    mocks.execute.mockRejectedValueOnce(new BackendRequestError("Sin conexion", 0));
    const view = await renderTraceabilityHook();

    await act(async () => {
      expect(await view.result.current.load(ids.product)).toBe(false);
    });
    expect(view.result.current.error).toBe("No hay conexión con el servidor. Intenta nuevamente.");
    expect(view.result.current.data).toBeNull();

    mocks.session = { ...mocks.session, hasPermission: () => false };
    view.rerender();
    await waitFor(() => expect(view.result.current.canQuery).toBe(false));
    await act(async () => {
      expect(await view.result.current.load(ids.product)).toBe(false);
    });
    expect(view.result.current.error).toContain("No dispone de permisos");
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });
});
