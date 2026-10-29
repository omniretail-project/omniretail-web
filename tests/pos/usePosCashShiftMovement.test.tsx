import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CashMovementType, CashShiftStatus } from "@/core/enums";
import type { DataEventPayload } from "@/core/types/events.types";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import type { CashMovementDto } from "@/modules/pos/application/dto/CashMovementDto";
import { usePosCashShift } from "@/modules/pos/hooks/usePosCashShift";
import { id, ids } from "./posFixtures";

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
  registerMovement: vi.fn(),
  close: vi.fn(),
  eventListener: null as null | ((payload: DataEventPayload) => void),
}));

const { service } = vi.hoisted(() => ({
  service: (name: "getOpen" | "getSummary" | "getMovements" | "registerMovement" | "close" | "open") =>
    class {
      execute(input: unknown) {
        return (mocks as unknown as Record<string, (input: unknown) => unknown>)[name]!(input);
      }
    },
}));

const stableRepositories = vi.hoisted(() => ({}));
vi.mock("@/infrastructure/providers/RepositoryProvider", () => ({
  useRepositories: () => stableRepositories,
}));
vi.mock("@/modules/auth/hooks/useCurrentSession", () => ({ useCurrentSession: () => mocks.session }));
const activeBranch = vi.hoisted(() => ({
  currentBranch: {
    id: "10000000-0000-4000-8000-000000000002",
    tenantId: "10000000-0000-4000-8000-000000000001",
    name: "Centro",
  },
  loading: false,
}));
vi.mock("@/shared/navigation/PrivateHeader/ActiveBranchProvider", () => ({ useActiveBranch: () => activeBranch }));
vi.mock("@/shared/hooks/useEntitlement", () => ({ useEntitlement: () => ({ hasCapability: () => true }) }));
vi.mock("@/shared/hooks/useDataEvent", () => ({
  useDataEvent: (_event: string, listener: (payload: DataEventPayload) => void) => {
    mocks.eventListener = listener;
  },
}));
vi.mock("@/modules/pos/application/services/GetOpenCashShiftService", () => ({ GetOpenCashShiftService: service("getOpen") }));
vi.mock("@/modules/pos/application/services/GetCashShiftSummaryService", () => ({ GetCashShiftSummaryService: service("getSummary") }));
vi.mock("@/modules/pos/application/services/GetCashShiftMovementsService", () => ({ GetCashShiftMovementsService: service("getMovements") }));
vi.mock("@/modules/pos/application/services/OpenCashShiftService", () => ({ OpenCashShiftService: service("open") }));
vi.mock("@/modules/pos/application/services/CloseCashShiftService", () => ({ CloseCashShiftService: service("close") }));
vi.mock("@/modules/pos/application/services/RegisterCashMovementService", () => ({ RegisterCashMovementService: service("registerMovement") }));

const shift = {
  id: ids.shift,
  branchId: ids.branch,
  userId: ids.user,
  registerCode: "POS-01",
  status: CashShiftStatus.open,
  openedAt: "2026-10-09T12:00:00.000Z",
  openingAmount: 100,
};

const created = (overrides: Partial<CashMovementDto> = {}): CashMovementDto => ({
  id: id(700),
  cashShiftId: ids.shift,
  type: CashMovementType.out,
  amount: 5,
  reason: "Bolsas",
  createdByUserId: ids.user,
  createdAt: "2026-10-28T10:00:00.000Z",
  ...overrides,
});

const expense = { type: CashMovementType.out, amount: 5, reason: "Bolsas" };
const income = { type: CashMovementType.in, amount: 25, reason: "Fondo adicional" };
const unconfirmed = () => new BackendRequestError("El backend devolvio un movimiento de caja invalido.", 502, "INVALID_BACKEND_RESPONSE");

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function loadedHook() {
  const view = renderHook(() => usePosCashShift());
  await waitFor(() => expect(view.result.current.cashShift?.id).toBe(ids.shift));
  return view;
}

describe("usePosCashShift: registro de movimientos de caja", () => {
  beforeEach(() => {
    mocks.eventListener = null;
    mocks.session = {
      user: { id: ids.user, tenantId: ids.tenant, name: "Cajera" },
      canAccessBranch: () => true,
      hasPermission: () => true,
      loading: false,
      error: null,
    };
    mocks.getOpen.mockReset().mockResolvedValue(shift);
    mocks.getSummary.mockReset().mockResolvedValue({ cashShiftId: ids.shift, expectedCash: 100 });
    mocks.getMovements.mockReset().mockResolvedValue([]);
    mocks.registerMovement.mockReset().mockResolvedValue({ id: id(700) });
    mocks.close.mockReset().mockResolvedValue({ ...shift, status: CashShiftStatus.closed });
  });

  describe("registro confirmado", () => {
    it("un ingreso se confirma, actualiza movimientos y resumen y no deja errores", async () => {
      const { result } = await loadedHook();
      const movement = created({ type: CashMovementType.in, amount: 25, reason: "Fondo adicional" });
      mocks.getMovements.mockResolvedValueOnce([movement]);
      mocks.getSummary.mockResolvedValueOnce({ cashShiftId: ids.shift, expectedCash: 125 });

      await act(async () => {
        expect(await result.current.registerMovement(income)).toBe(true);
      });

      expect(mocks.registerMovement).toHaveBeenCalledOnce();
      expect(mocks.registerMovement).toHaveBeenCalledWith(expect.objectContaining({ ...income, cashShiftId: ids.shift }));
      expect(result.current.movements).toEqual([movement]);
      expect(result.current.summary?.expectedCash).toBe(125);
      expect(result.current.successMessage).toBe("Movimiento de caja registrado correctamente.");
      expect(result.current.error).toBeNull();
      expect(result.current.movementError).toBeNull();
      expect(result.current.movementCheck).toBeNull();
    });

    it("un egreso se confirma y refleja el efectivo esperado menor", async () => {
      const { result } = await loadedHook();
      mocks.getMovements.mockResolvedValueOnce([created()]);
      mocks.getSummary.mockResolvedValueOnce({ cashShiftId: ids.shift, expectedCash: 95 });

      await act(async () => {
        expect(await result.current.registerMovement(expense)).toBe(true);
      });

      expect(mocks.registerMovement).toHaveBeenCalledWith(expect.objectContaining({ type: CashMovementType.out, amount: 5 }));
      expect(result.current.summary?.expectedCash).toBe(95);
      expect(result.current.error).toBeNull();
    });

    it("el refresco posterior es en segundo plano: la caja nunca se oculta ni se borra", async () => {
      const loadings: boolean[] = [];
      const view = renderHook(() => {
        const hook = usePosCashShift();
        loadings.push(hook.loading);
        return hook;
      });
      await waitFor(() => expect(view.result.current.cashShift?.id).toBe(ids.shift));
      loadings.length = 0;

      await act(async () => {
        await view.result.current.registerMovement(expense);
      });

      expect(loadings.every((value) => value === false)).toBe(true);
      expect(view.result.current.cashShift?.id).toBe(ids.shift);
    });

    it("si el refresco posterior falla NO se presenta como un registro fallido y se conserva la caja", async () => {
      const { result } = await loadedHook();
      mocks.getOpen.mockRejectedValueOnce(new BackendRequestError("Sin conexion", 0));

      await act(async () => {
        expect(await result.current.registerMovement(expense)).toBe(true);
      });

      expect(result.current.successMessage).toContain("registrado correctamente");
      expect(result.current.successMessage).toContain("No se pudo actualizar la lista");
      expect(result.current.error).toBeNull();
      expect(result.current.movementError).toBeNull();
      expect(result.current.cashShift?.id).toBe(ids.shift);
      expect(result.current.summary?.expectedCash).toBe(100);
      expect(mocks.registerMovement).toHaveBeenCalledOnce();
    });

    it("un fallo de las consultas de resumen o movimientos tras el registro tampoco lo invalida", async () => {
      const { result } = await loadedHook();
      mocks.getSummary.mockRejectedValueOnce(new Error("Resumen no disponible"));

      await act(async () => {
        expect(await result.current.registerMovement(expense)).toBe(true);
      });

      expect(result.current.error).toBeNull();
      expect(result.current.successMessage).toContain("No se pudo actualizar la lista");
      expect(result.current.cashShift?.id).toBe(ids.shift);
    });
  });

  describe("rechazo definitivo del backend", () => {
    it("conserva el formulario: devuelve false, informa el motivo y no bloquea un nuevo intento", async () => {
      const { result } = await loadedHook();
      mocks.registerMovement.mockRejectedValueOnce(new BackendRequestError("El monto excede el limite", 422));

      await act(async () => {
        expect(await result.current.registerMovement(expense)).toBe(false);
      });

      expect(result.current.movementError).toBe("El monto excede el limite");
      expect(result.current.movementCheck).toBeNull();
      expect(result.current.movements).toEqual([]);

      await act(async () => {
        expect(await result.current.registerMovement(expense)).toBe(true);
      });
      expect(mocks.registerMovement).toHaveBeenCalledTimes(2);
      expect(result.current.movementError).toBeNull();
    });

    it("un rechazo por permisos o turno no consulta la caja como si fuera incierto", async () => {
      const { result } = await loadedHook();
      mocks.registerMovement.mockRejectedValueOnce(new Error("No dispone de permisos para realizar esta operación de caja."));

      await act(async () => {
        expect(await result.current.registerMovement(expense)).toBe(false);
      });

      expect(result.current.movementError).toBe("No dispone de permisos para realizar esta operación de caja.");
      expect(result.current.movementCheck).toBeNull();
    });
  });

  describe("respuesta incierta", () => {
    it("si el movimiento aparece en la caja lo da por registrado sin enviar un segundo POST", async () => {
      const { result } = await loadedHook();
      mocks.registerMovement.mockRejectedValueOnce(unconfirmed());
      mocks.getMovements.mockResolvedValueOnce([created()]);

      await act(async () => {
        expect(await result.current.registerMovement(expense)).toBe(true);
      });

      expect(mocks.registerMovement).toHaveBeenCalledOnce();
      expect(result.current.movements).toHaveLength(1);
      expect(result.current.successMessage).toContain("aparece registrado");
      expect(result.current.error).toBeNull();
      expect(result.current.movementError).toBeNull();
      expect(result.current.movementCheck).toBeNull();
    });

    it("si no aparece NO asume que fallo: bloquea nuevos envios y pide verificar", async () => {
      const { result } = await loadedHook();
      mocks.registerMovement.mockRejectedValueOnce(unconfirmed());

      await act(async () => {
        expect(await result.current.registerMovement(expense)).toBe(false);
      });

      expect(result.current.movementCheck?.kind).toBe("not_found");
      expect(result.current.movementCheck?.message).toContain("no aparece");
      await act(async () => {
        expect(await result.current.registerMovement(expense)).toBe(false);
        expect(await result.current.registerMovement(income)).toBe(false);
      });
      expect(mocks.registerMovement).toHaveBeenCalledOnce();
    });

    it("tras verificar que no existe, abrir el formulario de nuevo libera el bloqueo de forma explicita", async () => {
      const { result } = await loadedHook();
      mocks.registerMovement.mockRejectedValueOnce(unconfirmed());
      await act(async () => {
        await result.current.registerMovement(expense);
      });

      act(() => result.current.resetMovementCheck());
      expect(result.current.movementCheck).toBeNull();

      await act(async () => {
        expect(await result.current.registerMovement(expense)).toBe(true);
      });
      expect(mocks.registerMovement).toHaveBeenCalledTimes(2);
    });

    it("un movimiento identico que ya existia no se toma por el recien enviado", async () => {
      const previous = created({ id: id(701) });
      mocks.getMovements.mockResolvedValue([previous]);
      const { result } = await loadedHook();
      await waitFor(() => expect(result.current.movements).toEqual([previous]));
      mocks.registerMovement.mockRejectedValueOnce(unconfirmed());

      await act(async () => {
        expect(await result.current.registerMovement(expense)).toBe(false);
      });

      expect(result.current.movementCheck?.kind).toBe("not_found");
      expect(result.current.successMessage).toBeNull();
    });

    it("dos movimientos nuevos iguales son ambiguos: se informa y no se envia otro", async () => {
      const { result } = await loadedHook();
      mocks.registerMovement.mockRejectedValueOnce(unconfirmed());
      mocks.getMovements.mockResolvedValueOnce([created({ id: id(702) }), created({ id: id(703) })]);

      await act(async () => {
        expect(await result.current.registerMovement(expense)).toBe(false);
      });

      expect(result.current.movementCheck?.kind).toBe("ambiguous");
      expect(mocks.registerMovement).toHaveBeenCalledOnce();
    });

    it("si ni siquiera se puede consultar la caja el bloqueo persiste aunque se reabra el formulario", async () => {
      const { result } = await loadedHook();
      mocks.registerMovement.mockRejectedValueOnce(unconfirmed());
      mocks.getOpen.mockRejectedValueOnce(new BackendRequestError("Sin conexion", 0));

      await act(async () => {
        expect(await result.current.registerMovement(expense)).toBe(false);
      });
      expect(result.current.movementCheck?.kind).toBe("unverifiable");

      act(() => result.current.resetMovementCheck());
      expect(result.current.movementCheck?.kind).toBe("unverifiable");
      await act(async () => {
        expect(await result.current.registerMovement(expense)).toBe(false);
      });
      expect(mocks.registerMovement).toHaveBeenCalledOnce();
    });

    it("verifyMovement consulta la caja sin enviar nada y resuelve el movimiento cuando aparece", async () => {
      const { result } = await loadedHook();
      mocks.registerMovement.mockRejectedValueOnce(unconfirmed());
      mocks.getOpen.mockRejectedValueOnce(new BackendRequestError("Sin conexion", 0));
      await act(async () => {
        await result.current.registerMovement(expense);
      });
      expect(result.current.movementCheck?.kind).toBe("unverifiable");

      mocks.getMovements.mockResolvedValueOnce([created()]);
      await act(async () => {
        expect(await result.current.verifyMovement()).toBe(true);
      });

      expect(mocks.registerMovement).toHaveBeenCalledOnce();
      expect(result.current.movementCheck).toBeNull();
      expect(result.current.successMessage).toContain("aparece registrado");
      expect(result.current.error).toBeNull();
    });

    it("verifyMovement sin un resultado pendiente no hace nada", async () => {
      const { result } = await loadedHook();
      const loadsBefore = mocks.getOpen.mock.calls.length;

      await act(async () => {
        expect(await result.current.verifyMovement()).toBe(false);
      });

      expect(mocks.getOpen.mock.calls.length).toBe(loadsBefore);
    });

    it("no se puede cerrar el turno con un movimiento sin verificar", async () => {
      const { result } = await loadedHook();
      mocks.registerMovement.mockRejectedValueOnce(unconfirmed());
      mocks.getOpen.mockRejectedValueOnce(new BackendRequestError("Sin conexion", 0));
      await act(async () => {
        await result.current.registerMovement(expense);
      });

      await act(async () => {
        expect(await result.current.closeCashShift(100)).toBe(false);
      });

      expect(mocks.close).not.toHaveBeenCalled();
      expect(result.current.error).toContain("movimiento de caja sin verificar");
    });
  });

  describe("solicitudes simultaneas", () => {
    it("un doble clic envia un solo POST: la segunda llamada se ignora", async () => {
      const { result } = await loadedHook();
      const pending = deferred<{ id: string }>();
      mocks.registerMovement.mockReturnValueOnce(pending.promise);

      let first!: Promise<boolean>;
      act(() => {
        first = result.current.registerMovement(expense);
      });
      await waitFor(() => expect(result.current.mutationLoading).toBe(true));

      await act(async () => {
        expect(await result.current.registerMovement(expense)).toBe(false);
      });
      expect(mocks.registerMovement).toHaveBeenCalledOnce();

      await act(async () => {
        pending.resolve({ id: id(700) });
        expect(await first).toBe(true);
      });
      expect(mocks.registerMovement).toHaveBeenCalledOnce();
      expect(result.current.mutationLoading).toBe(false);
    });

    it("un evento cash-shift.changed durante el registro no lanza una recarga paralela", async () => {
      const { result } = await loadedHook();
      const pending = deferred<{ id: string }>();
      mocks.registerMovement.mockReturnValueOnce(pending.promise);
      let registering!: Promise<boolean>;
      act(() => {
        registering = result.current.registerMovement(expense);
      });
      await waitFor(() => expect(result.current.mutationLoading).toBe(true));
      const loadsBefore = mocks.getOpen.mock.calls.length;

      act(() => mocks.eventListener?.({ entityId: ids.shift, action: "updated" }));
      expect(mocks.getOpen.mock.calls.length).toBe(loadsBefore);

      await act(async () => {
        pending.resolve({ id: id(700) });
        await registering;
      });
      // Solo la recarga del propio registro.
      expect(mocks.getOpen.mock.calls.length).toBe(loadsBefore + 1);
    });

    it("un evento fuera de una operacion si refresca en segundo plano sin ocultar la caja", async () => {
      const loadings: boolean[] = [];
      const view = renderHook(() => {
        const hook = usePosCashShift();
        loadings.push(hook.loading);
        return hook;
      });
      await waitFor(() => expect(view.result.current.cashShift?.id).toBe(ids.shift));
      loadings.length = 0;
      const loadsBefore = mocks.getOpen.mock.calls.length;

      await act(async () => {
        mocks.eventListener?.({ entityId: ids.shift, action: "updated" });
      });
      await waitFor(() => expect(mocks.getOpen.mock.calls.length).toBe(loadsBefore + 1));

      expect(loadings.every((value) => value === false)).toBe(true);
      expect(view.result.current.cashShift?.id).toBe(ids.shift);
    });
  });
});
