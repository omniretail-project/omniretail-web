import { describe, expect, it } from "vitest";
import { CashMovementType, CashShiftStatus } from "@/core/enums";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { toPosCashShiftDto } from "@/modules/pos/application/mappers/PosCashShiftMapper";
import { CloseCashShiftService } from "@/modules/pos/application/services/CloseCashShiftService";
import { GetCashShiftMovementsService } from "@/modules/pos/application/services/GetCashShiftMovementsService";
import { GetCashShiftSummaryService } from "@/modules/pos/application/services/GetCashShiftSummaryService";
import { GetOpenCashShiftService } from "@/modules/pos/application/services/GetOpenCashShiftService";
import { OpenCashShiftService } from "@/modules/pos/application/services/OpenCashShiftService";
import { RegisterCashMovementService } from "@/modules/pos/application/services/RegisterCashMovementService";
import {
  PosServiceError,
  cleanPosError,
  ensureOwnedOpenCashShift,
  requirePosApi,
} from "@/modules/pos/application/services/posServiceContext";
import {
  apiCashMovement,
  apiCashShift,
  cashContext,
  createPosRepositories,
  id,
  ids,
} from "./posFixtures";

const summary = {
  cashShiftId: ids.shift,
  branchId: ids.branch,
  cashierId: ids.user,
  registerCode: "POS-01",
  status: CashShiftStatus.open,
  openedAt: "2026-10-08T12:00:00.000Z",
  openingAmount: 100,
  cashIn: 300,
  cashOut: 10,
  manualCashIn: 25,
  manualCashOut: 10,
  salesCashIn: 275,
  voidCashOut: 0,
  returnCashOut: 0,
  expectedAmount: 390,
};

describe("servicios de caja en modo API", () => {
  it("GetOpenCashShift devuelve el turno del backend o null si no hay turno", async () => {
    const { repositories, posApi } = createPosRepositories();
    const service = new GetOpenCashShiftService(repositories);

    expect(await service.execute(cashContext)).toEqual(toPosCashShiftDto(apiCashShift));
    posApi.getOpenCashShift.mockResolvedValueOnce(null);
    expect(await service.execute(cashContext)).toBeNull();
    expect(posApi.getOpenCashShift).toHaveBeenCalledWith(ids.branch);
  });

  it("GetOpenCashShift rechaza un turno abierto por otro usuario", async () => {
    const { repositories, posApi } = createPosRepositories();
    posApi.getOpenCashShift.mockResolvedValueOnce({ ...apiCashShift, userId: id(99) });
    await expect(new GetOpenCashShiftService(repositories).execute(cashContext)).rejects.toThrow(
      "El turno de caja no está disponible para el contexto actual.",
    );
  });

  it("OpenCashShift abre en el backend con la sucursal validada", async () => {
    const { repositories, posApi } = createPosRepositories();
    const opened = await new OpenCashShiftService(repositories).execute({
      ...cashContext,
      registerCode: "POS-01",
      openingAmount: 100,
    });

    expect(opened.id).toBe(ids.shift);
    expect(posApi.openCashShift).toHaveBeenCalledWith({
      branchId: ids.branch,
      registerCode: "POS-01",
      openingAmount: 100,
    });
  });

  it("OpenCashShift exige la capacidad POS del plan", async () => {
    const { repositories, posApi } = createPosRepositories({ planCapabilities: [] });
    await expect(
      new OpenCashShiftService(repositories).execute({
        ...cashContext,
        registerCode: "POS-01",
        openingAmount: 100,
      }),
    ).rejects.toThrow();
    expect(posApi.openCashShift).not.toHaveBeenCalled();
  });

  it("CloseCashShift solo cierra el turno abierto del propio usuario", async () => {
    const { repositories, posApi } = createPosRepositories();
    const service = new CloseCashShiftService(repositories);

    const closed = await service.execute({ ...cashContext, cashShiftId: ids.shift, countedAmount: 390 });
    expect(closed.status).toBe(CashShiftStatus.closed);
    expect(posApi.closeCashShift).toHaveBeenCalledWith({ cashShiftId: ids.shift, countedAmount: 390 });

    await expect(
      service.execute({ ...cashContext, cashShiftId: id(98), countedAmount: 390 }),
    ).rejects.toThrow("El turno de caja no está disponible para el contexto actual.");
    posApi.getOpenCashShift.mockResolvedValueOnce(null);
    await expect(
      service.execute({ ...cashContext, cashShiftId: ids.shift, countedAmount: 390 }),
    ).rejects.toThrow();
    expect(posApi.closeCashShift).toHaveBeenCalledTimes(1);
  });

  it("GetCashShiftSummary combina resumen y movimientos del backend", async () => {
    const { repositories, posApi } = createPosRepositories();
    posApi.getCashShiftSummary.mockResolvedValue(summary);
    posApi.getCashShiftMovements.mockResolvedValue([
      apiCashMovement,
      { ...apiCashMovement, id: id(40) },
      { ...apiCashMovement, id: id(41), referenceType: undefined, referenceId: undefined },
      { ...apiCashMovement, id: id(42), referenceId: id(43) },
    ]);

    const result = await new GetCashShiftSummaryService(repositories).execute({
      ...cashContext,
      cashShiftId: ids.shift,
    });

    expect(result).toEqual({
      cashShiftId: ids.shift,
      status: CashShiftStatus.open,
      openedAt: summary.openedAt,
      openingAmount: 100,
      cashSalesAmount: 275,
      manualCashIn: 25,
      manualCashOut: 10,
      expectedCash: 390,
      movementCount: 4,
      saleCount: 2,
    });
  });

  it("GetCashShiftSummary rechaza un turno distinto del abierto", async () => {
    const { repositories, posApi } = createPosRepositories();
    await expect(
      new GetCashShiftSummaryService(repositories).execute({ ...cashContext, cashShiftId: id(97) }),
    ).rejects.toThrow("El turno de caja no está disponible para el contexto actual.");
    expect(posApi.getCashShiftSummary).not.toHaveBeenCalled();
  });

  it("GetCashShiftMovements lee del backend sin tocar los repositorios mock", async () => {
    const { repositories, posApi } = createPosRepositories();
    const service = new GetCashShiftMovementsService(repositories);

    expect(await service.execute({ ...cashContext, cashShiftId: ids.shift })).toEqual([apiCashMovement]);
    expect(posApi.getCashShiftMovements).toHaveBeenCalledWith(ids.shift);
    await expect(service.execute({ ...cashContext, cashShiftId: id(96) })).rejects.toThrow();
  });

  it("RegisterCashMovement registra en el backend solo sobre el turno vigente", async () => {
    const { repositories, posApi } = createPosRepositories();
    const service = new RegisterCashMovementService(repositories);
    const input = {
      ...cashContext,
      cashShiftId: ids.shift,
      type: CashMovementType.out,
      amount: 10,
      reason: "Compra de bolsas",
    };

    expect(await service.execute(input)).toEqual(apiCashMovement);
    expect(posApi.registerCashMovement).toHaveBeenCalledWith({
      cashShiftId: ids.shift,
      type: CashMovementType.out,
      amount: 10,
      reason: "Compra de bolsas",
    });
    await expect(service.execute({ ...input, cashShiftId: id(95) })).rejects.toThrow();
    expect(posApi.registerCashMovement).toHaveBeenCalledTimes(1);
  });

  it("rechaza usuarios sin permiso de caja o fuera de la sucursal", async () => {
    const withoutPermission = createPosRepositories({ role: { permissions: ["pos.sales.read"] } });
    await expect(
      new GetOpenCashShiftService(withoutPermission.repositories).execute(cashContext),
    ).rejects.toThrow("No dispone de permisos para realizar esta operación de caja.");

    const otherBranch = createPosRepositories({ user: { allowedBranchIds: [ids.otherBranch] } });
    await expect(
      new GetOpenCashShiftService(otherBranch.repositories).execute(cashContext),
    ).rejects.toThrow("No dispone de acceso a la sucursal seleccionada.");

    const missingContext = createPosRepositories();
    await expect(
      new GetOpenCashShiftService(missingContext.repositories).execute({ ...cashContext, branchId: " " }),
    ).rejects.toThrow("No se pudo resolver el contexto operativo de caja.");
  });
});

describe("posServiceContext", () => {
  it("requirePosApi exige el modo API y el repositorio configurado", () => {
    const { posApi } = createPosRepositories();
    expect(requirePosApi({ posDataSource: "api", posApi } as unknown as RepositoryRegistry)).toBe(posApi);
    expect(() => requirePosApi({ posDataSource: "mock" } as RepositoryRegistry)).toThrow(
      "La integración API de POS no está activa.",
    );
    expect(() => requirePosApi({ posDataSource: "api" } as RepositoryRegistry)).toThrow(
      "La integración API de POS no está disponible.",
    );
  });

  it("ensureOwnedOpenCashShift valida el turno del backend contra el contexto", async () => {
    const { repositories, posApi } = createPosRepositories();
    const input = { ...cashContext, cashShiftId: ids.shift };

    await expect(ensureOwnedOpenCashShift(repositories, input)).resolves.toEqual(apiCashShift);
    posApi.getOpenCashShift.mockResolvedValueOnce({ ...apiCashShift, status: CashShiftStatus.closed });
    await expect(ensureOwnedOpenCashShift(repositories, input)).rejects.toBeInstanceOf(PosServiceError);
    posApi.getOpenCashShift.mockResolvedValueOnce(null);
    await expect(ensureOwnedOpenCashShift(repositories, input)).rejects.toThrow(
      "No hay un turno de caja abierto y vigente para esta sucursal.",
    );
  });

  it.each([
    [new BackendRequestError("x", 401), "read", "Tu sesión expiró. Inicia sesión nuevamente para continuar."],
    [new BackendRequestError("x", 0), "idempotent", "pudo haberse registrado"],
    [new BackendRequestError("x", 503), "idempotent", "no se duplicará"],
    [new BackendRequestError("x", 0), "non_idempotent", "Verifica el estado de caja"],
    [new BackendRequestError("x", 500), "non_idempotent", "Verifica el estado de caja"],
    [new BackendRequestError("x", 0), "read", "No hay conexión con el servidor."],
    [new BackendRequestError("Stock insuficiente", 409), "idempotent", "Stock insuficiente"],
    [new BackendRequestError("", 422), "read", "fallback"],
    [new PosServiceError("Sin turno"), "read", "Sin turno"],
    [new Error(""), "read", "fallback"],
    ["texto", "read", "fallback"],
  ] as const)("cleanPosError traduce %s (%s)", (error, safety, expected) => {
    expect(cleanPosError(error, "fallback", safety)).toContain(expected);
  });
});
