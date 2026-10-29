import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataEventName } from "@/core/types/events.types";
import { CashMovementType } from "@/core/enums";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import { ApiPosRepository } from "@/infrastructure/api/repositories/ApiPosRepository";
import {
  parsePosCashMovements,
  parsePosCreatedCashMovement,
} from "@/infrastructure/api/repositories/posApi.schema";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { cashMovementJson, ids, jsonResponse, stubFetch } from "./posFixtures";

const command = { cashShiftId: ids.shift, type: CashMovementType.out, amount: 5, reason: " Bolsas " };
/** Lo minimo que confirma un movimiento recien creado: sin fecha, usuario ni referencias. */
const minimalCreated = { id: ids.movement, cashShiftId: ids.shift, type: CashMovementType.out, amount: 5 };

function repositoryWithEvents() {
  const eventBus = new DataEventBus();
  const events: Array<{ event: DataEventName; entityId?: string }> = [];
  eventBus.subscribe("cash-shift.changed", (payload) =>
    events.push({ event: "cash-shift.changed", entityId: payload?.entityId }),
  );
  return { repository: new ApiPosRepository(eventBus), events };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("registro de un movimiento manual: respuesta inmediata del POST", () => {
  it("una confirmacion 2xx sin fecha, usuario ni referencias se acepta como registrada", async () => {
    const calls = stubFetch(() => jsonResponse(minimalCreated, 201));
    const { repository, events } = repositoryWithEvents();

    const movement = await repository.registerCashMovement(command);

    expect(movement).toMatchObject({
      id: ids.movement,
      cashShiftId: ids.shift,
      type: CashMovementType.out,
      amount: 5,
      reason: "Bolsas",
    });
    expect(calls.map(({ method, url }) => [method, url])).toEqual([["POST", "/api/backend/pos/cash-movements"]]);
    expect(calls[0]?.body).toEqual({ cashShiftId: ids.shift, type: CashMovementType.out, amount: 5, reason: "Bolsas" });
    expect(events).toEqual([{ event: "cash-shift.changed", entityId: ids.shift }]);
  });

  it("acepta campos accesorios nulos y el monto como texto numerico", async () => {
    stubFetch(() =>
      jsonResponse({
        ...minimalCreated,
        amount: "5.00",
        reason: null,
        referenceType: null,
        referenceId: null,
        createdByUserId: null,
        createdAt: null,
        saleNumber: null,
      }),
    );
    const { repository } = repositoryWithEvents();

    const movement = await repository.registerCashMovement(command);

    expect(movement.amount).toBe(5);
    expect(movement.reason).toBe("Bolsas");
    expect(movement.referenceType).toBeUndefined();
  });

  it("una respuesta completa tambien funciona y conserva los datos que trae", async () => {
    stubFetch(() => jsonResponse({ ...cashMovementJson, type: CashMovementType.out, amount: 5, reason: "Bolsas", referenceType: null, referenceId: null, saleNumber: null }));
    const { repository } = repositoryWithEvents();

    const movement = await repository.registerCashMovement(command);

    expect(movement.createdByUserId).toBe(ids.user);
    expect(movement.createdAt).toBe(cashMovementJson.createdAt);
  });

  it.each<[string, Record<string, unknown>]>([
    ["sin id", { ...minimalCreated, id: undefined }],
    ["con un id que no es UUID", { ...minimalCreated, id: "123" }],
    ["sin turno", { ...minimalCreated, cashShiftId: undefined }],
    ["con un tipo desconocido", { ...minimalCreated, type: "transferencia" }],
    ["sin monto", { ...minimalCreated, amount: undefined }],
    ["con un monto no numerico", { ...minimalCreated, amount: "abc" }],
    ["con el monto nulo", { ...minimalCreated, amount: null }],
  ])("una respuesta %s NO se da por confirmada: error 502 sin evento", async (_label, body) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    stubFetch(() => jsonResponse(body, 201));
    const { repository, events } = repositoryWithEvents();

    await expect(repository.registerCashMovement(command)).rejects.toMatchObject({
      status: 502,
      code: "INVALID_BACKEND_RESPONSE",
    });
    expect(events).toEqual([]);
  });

  it.each<[string, Record<string, unknown>]>([
    ["otro monto", { ...minimalCreated, amount: 50 }],
    ["otro tipo", { ...minimalCreated, type: CashMovementType.in }],
    ["otro turno", { ...minimalCreated, cashShiftId: ids.branch }],
  ])("una respuesta con %s distinto al solicitado se rechaza como inconsistente", async (_label, body) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    stubFetch(() => jsonResponse(body, 201));
    const { repository } = repositoryWithEvents();

    await expect(repository.registerCashMovement(command)).rejects.toMatchObject({
      status: 502,
      code: "INVALID_BACKEND_RESPONSE",
    });
  });

  it("un rechazo del backend (400) se propaga como error y no emite eventos", async () => {
    stubFetch(() => new Response(JSON.stringify({ message: "Monto invalido" }), { status: 400 }));
    const { repository, events } = repositoryWithEvents();

    const failure = await repository.registerCashMovement(command).catch((cause: unknown) => cause);

    expect(failure).toBeInstanceOf(BackendRequestError);
    expect((failure as BackendRequestError).status).toBe(400);
    expect(events).toEqual([]);
  });

  it("nunca envia dos POST para una sola solicitud", async () => {
    const calls = stubFetch(() => jsonResponse({ ...minimalCreated, id: "invalido" }, 201));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { repository } = repositoryWithEvents();

    await repository.registerCashMovement(command).catch(() => undefined);

    expect(calls.filter(({ method }) => method === "POST")).toHaveLength(1);
  });

  it("la lectura autoritativa de la lista sigue siendo estricta", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(() => parsePosCashMovements([{ ...cashMovementJson, createdAt: null }])).toThrow(BackendRequestError);
    expect(parsePosCashMovements([cashMovementJson])).toHaveLength(1);
  });

  it("parsePosCreatedCashMovement completa solo el motivo con lo solicitado", () => {
    const parsed = parsePosCreatedCashMovement(minimalCreated, { reason: "Bolsas" });

    expect(parsed.reason).toBe("Bolsas");
    expect(parsed.createdByUserId).toBe("");
  });
});
