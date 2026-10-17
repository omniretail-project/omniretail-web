import { describe, expect, it, vi } from "vitest";
import {
  CashMovementType,
  CashShiftStatus,
  DeliveryMethod,
  OrderStatus,
  PaymentMethod,
  SaleStatus,
  TransportMode,
} from "@/core/enums";
import type { DataEventName } from "@/core/types/events.types";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import { ApiPosRepository } from "@/infrastructure/api/repositories/ApiPosRepository";
import {
  parseCashMovementCommand,
  parseCloseCashShiftCommand,
  parseConfirmSaleCommand,
  parseOpenCashShiftCommand,
  parseReturnCommand,
  parseVoidCommand,
} from "@/infrastructure/api/repositories/posApi.schema";
import { withApiPos } from "@/infrastructure/api/withApiPos";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import {
  cashMovementJson,
  cashShiftJson,
  cashSummaryJson,
  confirmSaleCommand,
  historyPageJson,
  ids,
  jsonResponse,
  returnEligibilityJson,
  returnOperationJson,
  saleConfirmationJson,
  saleDetailJson,
  stubFetch,
  voidOperationJson,
} from "./posFixtures";

const TRACKED_EVENTS: DataEventName[] = [
  "sale.changed",
  "sale.returned",
  "sale.voided",
  "inventory.changed",
  "stock.changed",
  "cash-shift.changed",
  "order.changed",
];

function recordEvents() {
  const eventBus = new DataEventBus();
  const events: Array<{ event: DataEventName; entityId?: string; branchId?: string }> = [];
  TRACKED_EVENTS.forEach((event) =>
    eventBus.subscribe(event, (payload) =>
      events.push({ event, entityId: payload?.entityId, branchId: payload?.branchId }),
    ),
  );
  return { eventBus, events, repository: new ApiPosRepository(eventBus) };
}

describe("ApiPosRepository - caja", () => {
  it("consulta el turno abierto y trata 204 como ausencia de turno", async () => {
    let reads = 0;
    const calls = stubFetch(() => {
      reads += 1;
      return reads === 1 ? jsonResponse(cashShiftJson) : new Response(null, { status: 204 });
    });
    const { repository } = recordEvents();

    const shift = await repository.getOpenCashShift(ids.branch);
    expect(shift?.id).toBe(ids.shift);
    expect(shift?.closedAt).toBeUndefined();
    expect(await repository.getOpenCashShift(ids.branch)).toBeNull();
    expect(calls.map(({ url }) => url)).toEqual([
      `/api/backend/pos/cash-shifts/open?branchId=${ids.branch}`,
      `/api/backend/pos/cash-shifts/open?branchId=${ids.branch}`,
    ]);
  });

  it("abre, cierra, resume y registra movimientos con payloads normalizados y eventos", async () => {
    const calls = stubFetch((url) => {
      if (url.endsWith("/cash-shifts/open")) return jsonResponse(cashShiftJson);
      if (url.endsWith("/cash-shifts/close")) {
        return jsonResponse({ ...cashShiftJson, status: CashShiftStatus.closed, countedAmount: 315.5 });
      }
      if (url.endsWith("/summary")) return jsonResponse(cashSummaryJson);
      if (url.includes("/cash-movements/shift/")) return jsonResponse([cashMovementJson]);
      return jsonResponse(cashMovementJson);
    });
    const { repository, events } = recordEvents();

    await repository.openCashShift({ branchId: ids.branch, registerCode: " POS-01 ", openingAmount: 100 });
    const closed = await repository.closeCashShift({ cashShiftId: ids.shift, countedAmount: 315.5 });
    const summary = await repository.getCashShiftSummary(ids.shift);
    const movements = await repository.getCashShiftMovements(ids.shift);
    await repository.registerCashMovement({
      cashShiftId: ids.shift,
      type: CashMovementType.in,
      amount: 25.5,
      reason: " Fondo adicional ",
    });

    expect(closed.status).toBe(CashShiftStatus.closed);
    expect(closed.countedAmount).toBe(315.5);
    expect(summary.salesCashIn).toBe(200);
    expect(summary.countedAmount).toBeUndefined();
    expect(movements[0]?.saleNumber).toBe("V-100");
    expect(calls.map(({ method, url }) => [method, url])).toEqual([
      ["POST", "/api/backend/pos/cash-shifts/open"],
      ["POST", "/api/backend/pos/cash-shifts/close"],
      ["GET", `/api/backend/pos/cash-shifts/${ids.shift}/summary`],
      ["GET", `/api/backend/pos/cash-movements/shift/${ids.shift}`],
      ["POST", "/api/backend/pos/cash-movements"],
    ]);
    expect(calls[0]?.body).toEqual({ branchId: ids.branch, registerCode: "POS-01", openingAmount: 100 });
    expect(calls[1]?.body).toEqual({ cashShiftId: ids.shift, countedAmount: 315.5 });
    expect(calls[4]?.body).toEqual({
      cashShiftId: ids.shift,
      type: CashMovementType.in,
      amount: 25.5,
      reason: "Fondo adicional",
    });
    expect(events).toEqual([
      { event: "cash-shift.changed", entityId: ids.shift, branchId: ids.branch },
      { event: "cash-shift.changed", entityId: ids.shift, branchId: ids.branch },
      { event: "cash-shift.changed", entityId: ids.shift, branchId: undefined },
    ]);
  });

  it("rechaza identificadores que no son UUID antes de llamar al backend", async () => {
    const calls = stubFetch(() => jsonResponse(cashShiftJson));
    const { repository } = recordEvents();
    await expect(repository.getOpenCashShift("mock-branch")).rejects.toThrow();
    await expect(repository.getCashShiftSummary("mock-shift")).rejects.toThrow();
    await expect(repository.getCashShiftMovements("mock-shift")).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

describe("ApiPosRepository - ventas", () => {
  it("confirma la venta con el contrato real, recorta el contacto y usa el resultado del backend", async () => {
    const calls = stubFetch(() => jsonResponse(saleConfirmationJson, 201));
    const { repository, events } = recordEvents();

    const result = await repository.confirmSale(confirmSaleCommand);

    expect(result.total).toBe(98.76);
    expect(result.payments).toHaveLength(3);
    expect(result.inventoryEffects).toEqual([{ id: ids.inventoryMovement }]);
    expect(result.cashMovement).toEqual({ id: ids.movement, cashShiftId: ids.shift, amount: 25.5 });
    const body = calls[0]?.body as Record<string, unknown>;
    expect(calls[0]?.url).toBe("/api/backend/pos/sales");
    expect(body).not.toHaveProperty("tenantId");
    expect(body.deferredOrder).toEqual({
      ...confirmSaleCommand.deferredOrder,
      storePickupContact: { recipientName: "Ana", recipientPhone: "5555-0101" },
    });
    expect(events.map(({ event }) => event)).toEqual([
      "sale.changed",
      "inventory.changed",
      "stock.changed",
      "cash-shift.changed",
      "order.changed",
    ]);
  });

  it("acepta una confirmación 201 con efectos accesorios nulos y sin caja ni pedido", async () => {
    stubFetch(() =>
      jsonResponse(
        {
          ...saleConfirmationJson,
          cashMovement: null,
          order: null,
          pickingOrder: null,
          inventoryEffects: [{ id: ids.inventoryMovement, createdAt: null }],
        },
        201,
      ),
    );
    const { repository, events } = recordEvents();

    const result = await repository.confirmSale(confirmSaleCommand);

    expect(result.cashMovement).toBeUndefined();
    expect(result.order).toBeUndefined();
    expect(result.pickingOrder).toBeUndefined();
    expect(events.map(({ event }) => event)).toEqual([
      "sale.changed",
      "inventory.changed",
      "stock.changed",
    ]);
  });

  it("no emite eventos si el backend rechaza la venta o responde un contrato inválido", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { repository, events } = recordEvents();

    stubFetch(() =>
      jsonResponse({ message: "Stock insuficiente", code: "INSUFFICIENT_STOCK" }, 409),
    );
    await expect(repository.confirmSale(confirmSaleCommand)).rejects.toMatchObject({
      status: 409,
      code: "INSUFFICIENT_STOCK",
      message: "Stock insuficiente",
    });

    stubFetch(() => jsonResponse({ ...saleConfirmationJson, total: "no-es-dinero" }, 201));
    await expect(repository.confirmSale(confirmSaleCommand)).rejects.toMatchObject({
      status: 502,
      code: "INVALID_BACKEND_RESPONSE",
      fields: { total: expect.any(String) },
    });

    expect(events).toEqual([]);
    expect(consoleError).toHaveBeenCalledWith(
      "[POS API] El backend devolvio una confirmacion de venta invalida.",
      { total: expect.any(String) },
    );
  });

  it("un listener que falla no convierte en error una venta confirmada", async () => {
    stubFetch(() => jsonResponse(saleConfirmationJson, 201));
    const eventBus = new DataEventBus();
    eventBus.subscribe("sale.changed", () => {
      throw new Error("listener roto");
    });

    await expect(new ApiPosRepository(eventBus).confirmSale(confirmSaleCommand)).resolves.toMatchObject({
      id: ids.sale,
    });
  });

  it("consulta el historial con filtros y paginación del backend y el detalle por id", async () => {
    const calls = stubFetch((url) =>
      url.includes("/sales/history") ? jsonResponse(historyPageJson) : jsonResponse(saleDetailJson),
    );
    const { repository } = recordEvents();

    const history = await repository.getSalesHistory({
      branchId: ids.branch,
      search: " V-100 ",
      from: "2026-10-01",
      to: "2026-10-08",
      status: SaleStatus.completed,
      deliveryMethod: DeliveryMethod.store_pickup,
      operationalStatus: OrderStatus.ready_for_pickup,
      page: 1,
      pageSize: 20,
    });
    const detail = await repository.getSaleDetail(ids.sale);
    await repository.getSalesHistory({ branchId: ids.branch, search: "   ", page: 2, pageSize: 50 });

    expect(history.items[0]?.deliveryMethod).toBe(DeliveryMethod.store_pickup);
    expect(detail.payments[2]?.method).toBe(PaymentMethod.transfer);
    expect(calls.map(({ url }) => url)).toEqual([
      `/api/backend/pos/sales/history?branchId=${ids.branch}&search=V-100&from=2026-10-01&to=2026-10-08&status=completed&deliveryMethod=store_pickup&operationalStatus=ready_for_pickup&page=1&size=20&sort=createdAt%2Cdesc`,
      `/api/backend/pos/sales/${ids.sale}`,
      `/api/backend/pos/sales/history?branchId=${ids.branch}&page=2&size=50&sort=createdAt%2Cdesc`,
    ]);
  });
});

describe("ApiPosRepository - devoluciones y anulaciones", () => {
  it("consulta la elegibilidad y devuelve null ante 404", async () => {
    let notFound = false;
    const calls = stubFetch(() =>
      notFound
        ? jsonResponse({ message: "Venta no encontrada", code: "SALE_NOT_FOUND" }, 404)
        : jsonResponse(returnEligibilityJson),
    );
    const { repository } = recordEvents();

    const eligibility = await repository.getReturnEligibility(ids.branch, "V-100");
    notFound = true;
    const missing = await repository.getReturnEligibility(ids.branch, "V-999");

    expect(eligibility?.items[0]?.returnableQuantity).toBe(2);
    expect(eligibility?.items[0]?.blockedReason).toBeUndefined();
    expect(missing).toBeNull();
    expect(calls[0]?.url).toBe(
      `/api/backend/pos/sales/returns/eligibility?branchId=${ids.branch}&documentNumber=V-100`,
    );
  });

  it("propaga los errores de elegibilidad distintos de 404", async () => {
    stubFetch(() => jsonResponse({ message: "Ocurrio un error inesperado.", code: "INTERNAL_ERROR" }, 500));
    const { repository } = recordEvents();
    await expect(repository.getReturnEligibility(ids.branch, "V-100")).rejects.toMatchObject({
      status: 500,
      message: "Ocurrio un error inesperado.",
    });
  });

  it("envía la Idempotency-Key en devoluciones y anulaciones y refresca venta, inventario y caja", async () => {
    const calls = stubFetch((url) =>
      url.endsWith("/returns") ? jsonResponse(returnOperationJson, 201) : jsonResponse(voidOperationJson),
    );
    const { repository, events } = recordEvents();
    const returnBody = {
      reason: "Producto incorrecto",
      lines: [{ saleItemId: ids.saleItem, quantity: 1, trackingSelections: [] as [] }],
    };

    const returned = await repository.processReturn(ids.sale, ids.request, returnBody);
    const voided = await repository.voidSale(ids.sale, ids.request, { reason: " Venta duplicada " });

    expect(returned.saleStatus).toBe(SaleStatus.partially_returned);
    expect(voided.sale.status).toBe(SaleStatus.cancelled);
    expect(calls.map(({ method, url, idempotencyKey }) => [method, url, idempotencyKey])).toEqual([
      ["POST", `/api/backend/pos/sales/${ids.sale}/returns`, ids.request],
      ["POST", `/api/backend/pos/sales/${ids.sale}/void`, ids.request],
    ]);
    expect(calls[0]?.body).toEqual(returnBody);
    expect(calls[1]?.body).toEqual({ reason: "Venta duplicada" });
    const sequence = (event: DataEventName) => [
      event,
      "sale.changed",
      "inventory.changed",
      "stock.changed",
      "cash-shift.changed",
    ];
    expect(events.map(({ event }) => event)).toEqual([
      ...sequence("sale.returned"),
      ...sequence("sale.voided"),
    ]);
  });

  it("no emite eventos de inventario ni caja si la reversa no los registró", async () => {
    stubFetch(() =>
      jsonResponse({
        ...voidOperationJson,
        inventory: { inventoryRestored: false, movementIds: [] },
        cashMovement: { recorded: false, movementIds: [], amount: null },
      }),
    );
    const { repository, events } = recordEvents();

    await repository.voidSale(ids.sale, ids.request, { reason: "Error de cobro" });

    expect(events.map(({ event }) => event)).toEqual(["sale.voided", "sale.changed"]);
  });

  it("exige UUID para la venta y la clave de idempotencia", async () => {
    const calls = stubFetch(() => jsonResponse(voidOperationJson));
    const { repository } = recordEvents();
    await expect(repository.voidSale("venta-1", ids.request, { reason: "x" })).rejects.toThrow();
    await expect(repository.voidSale(ids.sale, "clave", { reason: "x" })).rejects.toThrow();
    await expect(
      repository.processReturn(ids.sale, "clave", { reason: "x", lines: [] }),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

describe("ApiPosRepository - errores HTTP y de red", () => {
  it.each([400, 401, 403, 404, 409, 422, 500])("preserva status, código y campos ante %s", async (status) => {
    stubFetch(() =>
      jsonResponse({ message: `HTTP ${status}`, code: `POS_${status}`, fields: { reason: "invalid" } }, status),
    );
    const { repository } = recordEvents();
    await expect(repository.getCashShiftSummary(ids.shift)).rejects.toMatchObject({
      status,
      code: `POS_${status}`,
      fields: { reason: "invalid" },
    });
  });

  it("convierte un fallo de red en status 0", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network unavailable")));
    const { repository } = recordEvents();
    const error = await repository.getCashShiftSummary(ids.shift).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(BackendRequestError);
    expect((error as BackendRequestError).status).toBe(0);
  });
});

describe("validación de comandos POS", () => {
  const invalidRequest = (run: () => unknown) => {
    try {
      run();
    } catch (error) {
      return error;
    }
    throw new Error("La petición debía rechazarse");
  };

  it.each([
    ["sucursal no UUID", () => parseOpenCashShiftCommand({ branchId: "mock", registerCode: "POS", openingAmount: 1 })],
    ["monto de apertura NaN", () => parseOpenCashShiftCommand({ branchId: ids.branch, registerCode: "POS", openingAmount: Number.NaN })],
    ["monto contado negativo", () => parseCloseCashShiftCommand({ cashShiftId: ids.shift, countedAmount: -1 })],
    ["movimiento sin motivo", () => parseCashMovementCommand({ cashShiftId: ids.shift, type: CashMovementType.in, amount: 5, reason: "  " })],
    ["devolución sin líneas", () => parseReturnCommand({ reason: "x", lines: [] })],
    ["anulación sin motivo", () => parseVoidCommand({ reason: "" })],
    ["venta sin ítems", () => parseConfirmSaleCommand({ ...confirmSaleCommand, items: [] })],
    [
      "retiro en tienda sin contacto",
      () =>
        parseConfirmSaleCommand({
          ...confirmSaleCommand,
          deferredOrder: { ...confirmSaleCommand.deferredOrder, storePickupContact: undefined },
        }),
    ],
    [
      "contacto de retiro en blanco",
      () =>
        parseConfirmSaleCommand({
          ...confirmSaleCommand,
          deferredOrder: {
            ...confirmSaleCommand.deferredOrder,
            storePickupContact: { recipientName: "   ", recipientPhone: "5555-0101" },
          },
        }),
    ],
    [
      "entrega a domicilio sin dirección",
      () =>
        parseConfirmSaleCommand({
          ...confirmSaleCommand,
          deferredOrder: {
            idempotencyKey: "order-attempt-2",
            deliveryMethod: DeliveryMethod.home_delivery,
            transportMode: TransportMode.own_fleet,
          },
        }),
    ],
  ])("rechaza %s con 400 INVALID_POS_REQUEST", (_label, run) => {
    expect(invalidRequest(run)).toMatchObject({ status: 400, code: "INVALID_POS_REQUEST" });
  });

  it("identifica la dirección faltante en entrega a domicilio", () => {
    const error = invalidRequest(() =>
      parseConfirmSaleCommand({
        ...confirmSaleCommand,
        deferredOrder: {
          idempotencyKey: "order-attempt-2",
          deliveryMethod: DeliveryMethod.home_delivery,
          transportMode: TransportMode.own_fleet,
        },
      }),
    ) as BackendRequestError;
    expect(error.fields).toHaveProperty("deferredOrder.deliveryAddress");
  });

  it("identifica el campo inválido del contacto de retiro", () => {
    const error = invalidRequest(() =>
      parseConfirmSaleCommand({
        ...confirmSaleCommand,
        deferredOrder: { ...confirmSaleCommand.deferredOrder, storePickupContact: undefined },
      }),
    ) as BackendRequestError;
    expect(error.fields).toHaveProperty("deferredOrder.storePickupContact");
  });
});

describe("withApiPos", () => {
  it("decora el registro sin mutar el original", () => {
    const original = { posDataSource: "mock", marker: true } as unknown as RepositoryRegistry;
    const decorated = withApiPos(original, new DataEventBus());

    expect(decorated).not.toBe(original);
    expect(decorated.posDataSource).toBe("api");
    expect(decorated.posApi).toBeInstanceOf(ApiPosRepository);
    expect(original.posDataSource).toBe("mock");
    expect(original.posApi).toBeUndefined();
  });
});
