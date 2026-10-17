import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CashMovementType, CashShiftStatus } from "@/core/enums";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import {
  PendingSaleConfirmationStore,
  pendingSaleScopeKey,
} from "@/modules/pos/application/services/pendingSaleConfirmation";
import { usePosCashShift } from "@/modules/pos/hooks/usePosCashShift";
import { ids } from "./posFixtures";

const mocks = vi.hoisted(() => ({
  session: {} as {
    user: { id: string; tenantId: string; name: string } | null;
    canAccessBranch: (branchId: string) => boolean;
    hasPermission: (permission: string) => boolean;
    loading: boolean;
    error: string | null;
  },
  getOpen: vi.fn(),
  getSummary: vi.fn(),
  getMovements: vi.fn(),
  open: vi.fn(),
  close: vi.fn(),
  registerMovement: vi.fn(),
}));

const { service } = vi.hoisted(() => ({
  service: (name: "getOpen" | "getSummary" | "getMovements" | "open" | "close" | "registerMovement") =>
    class {
      execute(input: unknown) {
        return mocks[name](input);
      }
    },
}));

const stableRepositories = vi.hoisted(() => ({}));
vi.mock("@/infrastructure/providers/RepositoryProvider", () => ({
  useRepositories: () => stableRepositories,
}));
vi.mock("@/modules/auth/hooks/useCurrentSession", () => ({
  useCurrentSession: () => mocks.session,
}));
// El provider real entrega una referencia estable; un objeto nuevo por render recrearía `reload`.
const activeBranch = vi.hoisted(() => ({
  currentBranch: {
    id: "10000000-0000-4000-8000-000000000002",
    tenantId: "10000000-0000-4000-8000-000000000001",
    name: "Centro",
  },
  loading: false,
}));
vi.mock("@/shared/navigation/PrivateHeader/ActiveBranchProvider", () => ({
  useActiveBranch: () => activeBranch,
}));
vi.mock("@/shared/hooks/useEntitlement", () => ({
  useEntitlement: () => ({ hasCapability: () => true }),
}));
vi.mock("@/shared/hooks/useDataEvent", () => ({ useDataEvent: () => undefined }));

vi.mock("@/modules/pos/application/services/GetOpenCashShiftService", () => ({
  GetOpenCashShiftService: service("getOpen"),
}));
vi.mock("@/modules/pos/application/services/GetCashShiftSummaryService", () => ({
  GetCashShiftSummaryService: service("getSummary"),
}));
vi.mock("@/modules/pos/application/services/GetCashShiftMovementsService", () => ({
  GetCashShiftMovementsService: service("getMovements"),
}));
vi.mock("@/modules/pos/application/services/OpenCashShiftService", () => ({
  OpenCashShiftService: service("open"),
}));
vi.mock("@/modules/pos/application/services/CloseCashShiftService", () => ({
  CloseCashShiftService: service("close"),
}));
vi.mock("@/modules/pos/application/services/RegisterCashMovementService", () => ({
  RegisterCashMovementService: service("registerMovement"),
}));

const shift = {
  id: ids.shift,
  branchId: ids.branch,
  userId: ids.user,
  registerCode: "POS-01",
  status: CashShiftStatus.open,
  openedAt: "2026-10-09T12:00:00.000Z",
  openingAmount: 100,
};

describe("usePosCashShift", () => {
  beforeEach(() => {
    mocks.session = {
      user: { id: ids.user, tenantId: ids.tenant, name: "Cajera" },
      canAccessBranch: () => true,
      hasPermission: () => true,
      loading: false,
      error: null,
    };
    mocks.getOpen.mockResolvedValue(shift);
    mocks.getSummary.mockResolvedValue({ cashShiftId: ids.shift, expectedCash: 100 });
    mocks.getMovements.mockResolvedValue([]);
    mocks.open.mockResolvedValue(shift);
    mocks.close.mockResolvedValue({ ...shift, status: CashShiftStatus.closed });
    mocks.registerMovement.mockResolvedValue({ id: ids.movement });
  });

  it("carga el turno abierto con su resumen y movimientos", async () => {
    const { result } = renderHook(() => usePosCashShift());
    await waitFor(() => expect(result.current.summary?.expectedCash).toBe(100));
    expect(result.current.cashShift?.id).toBe(ids.shift);
    expect(mocks.getSummary).toHaveBeenCalledWith(expect.objectContaining({ cashShiftId: ids.shift }));
  });

  it("sin turno abierto no consulta resumen ni movimientos", async () => {
    mocks.getOpen.mockResolvedValue(null);
    const { result } = renderHook(() => usePosCashShift());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.cashShift).toBeNull();
    expect(mocks.getSummary).not.toHaveBeenCalled();
  });

  it("abre, registra un movimiento y cierra refrescando el estado real", async () => {
    mocks.getOpen.mockResolvedValueOnce(null);
    const { result } = renderHook(() => usePosCashShift());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      expect(await result.current.openCashShift({ registerCode: "POS-01", openingAmount: 100 })).toBe(true);
    });
    expect(result.current.successMessage).toBe("Caja POS-01 abierta correctamente.");

    await act(async () => {
      expect(
        await result.current.registerMovement({ type: CashMovementType.in, amount: 10, reason: "Fondo" }),
      ).toBe(true);
    });
    expect(result.current.successMessage).toBe("Movimiento de caja registrado correctamente.");

    await act(async () => {
      expect(await result.current.closeCashShift(100)).toBe(true);
    });
    expect(result.current.lastClosedShift?.status).toBe(CashShiftStatus.closed);
  });

  it("ante un fallo incierto pide verificar la caja y recarga el estado del backend", async () => {
    const { result } = renderHook(() => usePosCashShift());
    await waitFor(() => expect(result.current.cashShift?.id).toBe(ids.shift));
    const loadsBefore = mocks.getOpen.mock.calls.length;
    mocks.registerMovement.mockRejectedValueOnce(new BackendRequestError("x", 503));

    await act(async () => {
      expect(
        await result.current.registerMovement({ type: CashMovementType.out, amount: 5, reason: "Bolsas" }),
      ).toBe(false);
    });

    expect(result.current.error).toBe(
      "El servidor no confirmó la operación. Verifica el estado de caja antes de repetirla.",
    );
    expect(mocks.getOpen.mock.calls.length).toBe(loadsBefore + 1);
  });

  it("muestra el error de carga del backend", async () => {
    mocks.getOpen.mockRejectedValue(new BackendRequestError("Sin permisos de caja", 403));
    const { result } = renderHook(() => usePosCashShift());
    await waitFor(() => expect(result.current.error).toBe("Sin permisos de caja"));
    expect(result.current.cashShift).toBeNull();
  });

  it("un fallo al abrir o cerrar también recarga el estado", async () => {
    const { result } = renderHook(() => usePosCashShift());
    await waitFor(() => expect(result.current.cashShift?.id).toBe(ids.shift));
    mocks.open.mockRejectedValueOnce(new BackendRequestError("Ya existe un turno abierto", 409));
    mocks.close.mockRejectedValueOnce(new BackendRequestError("Turno no encontrado", 404));
    const loadsBefore = mocks.getOpen.mock.calls.length;

    await act(async () => {
      expect(await result.current.openCashShift({ registerCode: "POS-02", openingAmount: 50 })).toBe(false);
    });
    await act(async () => {
      expect(await result.current.closeCashShift(100)).toBe(false);
    });

    expect(mocks.getOpen.mock.calls.length).toBe(loadsBefore + 2);
    expect(result.current.error).toBe("Turno no encontrado");
  });

  it("no cierra el turno mientras haya una venta pendiente de verificar", async () => {
    const { result } = renderHook(() => usePosCashShift());
    await waitFor(() => expect(result.current.cashShift?.id).toBe(ids.shift));
    const scope = pendingSaleScopeKey(ids.user, activeBranch.currentBranch.tenantId, activeBranch.currentBranch.id);
    new PendingSaleConfirmationStore().save({
      version: 1,
      contextKey: scope,
      confirmationId: "conf-1",
      input: { branchId: ids.branch, cashShiftId: ids.shift, ticket: {} as never, checkout: {} as never },
      createdAt: "2026-10-10T12:00:00.000Z",
      attempts: 1,
    });

    await act(async () => {
      expect(await result.current.closeCashShift(100)).toBe(false);
    });

    expect(mocks.close).not.toHaveBeenCalled();
    expect(result.current.error).toContain("venta pendiente de verificar");
    window.sessionStorage.clear();
  });
});
